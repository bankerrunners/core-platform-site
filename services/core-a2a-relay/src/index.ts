import { intakeFetch, intakeAlarm } from './intake-bridge.ts';
import { dispatcherFetch } from './dispatcher-bridge.ts';
import { matchesRegisteredOAuthRedirect, oauthAuthorizationMetadata, oauthProtectedResourceMetadata, signOAuthPayload, verifyOAuthPayload, verifyPkce, validOAuthRedirect } from "./oauth.ts";
import { MAILBOX_TOOLS, mailboxCall, mailboxEnabled, mailboxTools } from "./mailbox.ts";
import { inboxIdentity } from "./inbox-identity.ts";
import { issueOAuthSession, refreshOAuthSession, refreshFamilyRequest } from "./oauth-refresh.ts";

export interface Env {
  INTAKE_CANDIDATE_CONFIG?: string;
  DISPATCHER_TOKEN?: string;
  WORKER_D_STATUS_ENABLED?: string;
  MCP_PEER_MESSAGES_ENABLED?: string;
  MCP_MAIN_OFFICE_MESSAGES_ENABLED?: string;
  MCP_CODEX_OAUTH_CLIENT_SHA256?: string;
  MCP_CLAUDE_DESKTOP_OAUTH_CLIENT_SHA256?: string;
  A2A_JOB: DurableObjectNamespace;
  MCP_PIPE: DurableObjectNamespace;
  N8N_SHARED_SECRET: string;
  CONNECTOR_SHARED_SECRET: string;
  MCP_CONNECTOR_SHARED_SECRET: string;
  BIONIC_MCP_TOKEN_SHA256: string;
  AGENT_B_MCP_TOKEN_SHA256: string;
  AGENT_C_MCP_TOKEN_SHA256: string;
  WORKER_ZERO_MCP_TOKEN_SHA256: string;
  CURSOR_MCP_TOKEN_SHA256: string;
  MAX_JOB_BYTES: string;
  JOB_TTL_SECONDS: string;
  MCP_CALL_TIMEOUT_MS: string;
  MCP_MAX_REQUEST_BYTES: string;
  MCP_MAX_RESULT_BYTES: string;
  INKBOX_SMS_WEBHOOK_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OAUTH_SIGNING_SECRET: string;
  OAUTH_STATE: DurableObjectNamespace;
  GITHUB_ALLOWED_LOGIN: string;
}

type JobState = "PENDING" | "LEASED" | "COMPLETED" | "HELD" | "EXPIRED";
interface Job { id: string; correlation_id: string; idempotency_key: string; payload: unknown; state: JobState; created_at: string; lease_until?: string; result?: unknown }

const encoder = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/candidate-intake/') || url.pathname.startsWith('/dispatcher/')) {
      return env.A2A_JOB.get(env.A2A_JOB.idFromName('inkbox-intake-v1')).fetch(request);
    }
    const pipe = env.MCP_PIPE.get(env.MCP_PIPE.idFromName("worker-d"));
    const oauthPath = url.pathname.startsWith("/oauth/") || url.pathname.startsWith("/.well-known/oauth-");
    if (oauthPath && !oauthConfigured(env)) return json({ error: "temporarily_unavailable" }, 503);
    if (request.method === "GET" && url.pathname === "/health") {
      const status = await pipe.fetch("https://pipe/status");
      const connector = await status.json<{ online: boolean; degraded: boolean }>();
      return json({ ready: true, service: "core-a2a-relay", mcp_protocol: "2025-03-26", state: connector.online ? (connector.degraded ? "CONNECTOR_DEGRADED" : "GATEWAY_READY_CONNECTOR_ONLINE") : "GATEWAY_READY_CONNECTOR_OFFLINE", worker_d_public: false });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") return json(oauthAuthorizationMetadata(url.origin));
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) return json(oauthProtectedResourceMetadata(url.origin));
    if (request.method === "GET" && url.pathname === "/oauth/authorize") return authorizeOAuthClient(url, env);
    if (request.method === "GET" && url.pathname === "/oauth/github/callback") return handleGitHubOAuthCallback(url, env);
    if (request.method === "POST" && url.pathname === "/oauth/token") return exchangeOAuthToken(request, env);
    if (url.pathname === "/v1/connector" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (!constantEqual(request.headers.get("authorization") ?? "", `Bearer ${env.MCP_CONNECTOR_SHARED_SECRET}`)) return json({ error: "UNAUTHORIZED" }, 401);
      return pipe.fetch(request);
    }
    if (url.pathname === "/mcp") return handleMcp(request, env, pipe);
    if (request.method === "POST" && url.pathname === "/oauth/register") return registerOAuthClient(request, env);
    if (request.method === "POST" && url.pathname === "/v1/inkbox/text-events") return handleInkboxTextEvent(request, env);
    const actor = authenticate(request, env);
    if (!actor) return json({ error: "UNAUTHORIZED" }, 401);
    if (request.method === "POST" && url.pathname === "/v1/jobs" && actor === "n8n") return createJob(request, env);
    if (request.method === "GET" && url.pathname === "/v1/jobs/next" && actor === "connector") return leaseJob(env);
    const resultMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/result$/);
    if (request.method === "POST" && resultMatch && actor === "connector") return completeJob(resultMatch[1]!, request, env);
    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch && actor === "n8n") return readJob(jobMatch[1]!, env);
    return json({ error: "NOT_FOUND" }, 404);
  },
};

function oauthConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.OAUTH_SIGNING_SECRET?.length >= 32 && env.GITHUB_ALLOWED_LOGIN);
}

async function registerOAuthClient(request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ error: "invalid_client_metadata" }, 400);
  let input: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown; application_type?: unknown };
  const raw = await readLimitedText(request, 16384);
  if (raw === null) return json({ error: "invalid_client_metadata" }, 400);
  try { input = JSON.parse(raw) as typeof input; } catch { return json({ error: "invalid_client_metadata" }, 400); }
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length < 1 || input.redirect_uris.length > 5) return json({ error: "invalid_redirect_uri" }, 400);
  const redirectUris = input.redirect_uris.filter((value): value is string => typeof value === "string");
  if (redirectUris.length !== input.redirect_uris.length || redirectUris.some((value) => !validOAuthRedirect(value))) return json({ error: "invalid_redirect_uri" }, 400);
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== "none") return json({ error: "invalid_client_metadata" }, 400);
  if (input.application_type && input.application_type !== "native" && input.application_type !== "web") return json({ error: "invalid_client_metadata" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const applicationType = input.application_type === "web" ? "web" : "native";
  const issuer = new URL(request.url).origin;
  const clientId = await signOAuthPayload({ kind: "oauth_client", iss: issuer, redirect_uris: redirectUris, client_name: typeof input.client_name === "string" ? input.client_name.slice(0, 128) : "Cursor", application_type: applicationType, iat: now, exp: now + 31536000 }, env.OAUTH_SIGNING_SECRET);
  return json({ client_id: clientId, client_id_issued_at: now, redirect_uris: redirectUris, client_name: typeof input.client_name === "string" ? input.client_name.slice(0, 128) : "Cursor", application_type: applicationType, token_endpoint_auth_method: "none" }, 201);
}

async function authorizeOAuthClient(url: URL, env: Env): Promise<Response> {
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const clientState = url.searchParams.get("state") ?? "";
  const resource = url.searchParams.get("resource");
  const expectedResource = url.origin + "/mcp";
  if (url.searchParams.has("scope") && url.searchParams.get("scope") !== "mcp:tools") return json({ error: "invalid_scope" }, 400);
  if (responseType !== "code" || !clientId || clientId.length > 4096 || !redirectUri || redirectUri.length > 2048 || !codeChallenge || codeChallengeMethod !== "S256" || clientState.length > 512 || resource !== expectedResource) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return json({ error: "invalid_request" }, 400);
  const client = await verifyOAuthPayload(clientId, env.OAUTH_SIGNING_SECRET);
  const registeredRedirects = client?.kind === "oauth_client" && Array.isArray(client.redirect_uris)
    ? client.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];
  if (client?.iss !== url.origin || !matchesRegisteredOAuthRedirect(redirectUri, registeredRedirects, client.application_type)) return json({ error: "invalid_client" }, 400);
  const transactionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const transaction = await signOAuthPayload({
    kind: "oauth_transaction",
    iss: url.origin,
    transaction_id: transactionId,
    client_id: clientId,
    redirect_uri: redirectUri,
    client_state: clientState,
    code_challenge: codeChallenge,
    resource,
    iat: now,
    exp: now + 300,
  }, env.OAUTH_SIGNING_SECRET);
  const stateObject = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName(transactionId));
  const stored = await stateObject.fetch(new Request("https://oauth-state.local/?key=" + encodeURIComponent(transactionId) + "&ttl=300", {
    method: "PUT",
    body: transaction,
  }));
  if (!stored.ok) return json({ error: "temporarily_unavailable" }, 503);
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", url.origin + "/oauth/github/callback");
  github.searchParams.set("scope", "repo");
  github.searchParams.set("state", transactionId);
  return redirectNoStore(github.toString());
}

async function handleGitHubOAuthCallback(url: URL, env: Env): Promise<Response> {
  const transactionId = url.searchParams.get("state");
  const githubCode = url.searchParams.get("code");
  if (!transactionId || !githubCode) return json({ error: "invalid_request" }, 400);
  const stateObject = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName(transactionId));
  const stateUrl = "https://oauth-state.local/?key=" + encodeURIComponent(transactionId);
  const storedResponse = await stateObject.fetch(new Request(stateUrl, { method: "POST" }));
  if (!storedResponse.ok) return json({ error: "invalid_grant" }, 400);
  const stored = await storedResponse.json<{ value?: string }>();
  if (!stored.value) return json({ error: "invalid_grant" }, 400);
  const transaction = await verifyOAuthPayload(stored.value, env.OAUTH_SIGNING_SECRET);
  if (transaction?.kind !== "oauth_transaction" || transaction.iss !== url.origin || transaction.transaction_id !== transactionId) return json({ error: "invalid_grant" }, 400);
  const callbackUri = url.origin + "/oauth/github/callback";
  const exchange = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: githubCode, redirect_uri: callbackUri }),
  });
  if (!exchange.ok) return json({ error: "temporarily_unavailable" }, 502);
  const githubToken = await exchange.json<{ access_token?: string; error?: string }>();
  if (!githubToken.access_token) return json({ error: "access_denied" }, 401);
  const profileResponse = await fetch("https://api.github.com/user", {
    headers: { authorization: "Bearer " + githubToken.access_token, accept: "application/vnd.github+json", "user-agent": "core-a2a-relay" },
  });
  if (!profileResponse.ok) return json({ error: "access_denied" }, 401);
  const profile = await profileResponse.json<{ id?: number; login?: string }>();
  if (!profile.id || !profile.login) return json({ error: "access_denied" }, 401);
  if (!env.GITHUB_ALLOWED_LOGIN || profile.login.toLowerCase() !== env.GITHUB_ALLOWED_LOGIN.toLowerCase()) return json({ error: "access_denied" }, 403);
  const authorizationCode = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const codePayload = await signOAuthPayload({
    kind: "oauth_code",
    iss: url.origin,
    code_id: authorizationCode,
    client_id: transaction.client_id,
    redirect_uri: transaction.redirect_uri,
    code_challenge: transaction.code_challenge,
    resource: transaction.resource,
    github_id: profile.id,
    github_login: profile.login,
    iat: now,
    exp: now + 120,
  }, env.OAUTH_SIGNING_SECRET);
  const codeObject = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName(authorizationCode));
  const codeUrl = "https://oauth-state.local/?key=" + encodeURIComponent(authorizationCode) + "&ttl=120";
  const codeStored = await codeObject.fetch(new Request(codeUrl, { method: "PUT", body: codePayload }));
  if (!codeStored.ok) return json({ error: "temporarily_unavailable" }, 503);
  const redirect = new URL(String(transaction.redirect_uri));
  redirect.searchParams.set("code", authorizationCode);
  redirect.searchParams.set("iss", url.origin);
  if (typeof transaction.client_state === "string" && transaction.client_state) redirect.searchParams.set("state", transaction.client_state);
  return redirectNoStore(redirect.toString());
}

async function exchangeOAuthToken(request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/x-www-form-urlencoded")) {
    return json({ error: "invalid_request" }, 400);
  }
  const raw = await readLimitedText(request, 16384);
  if (raw === null) return json({ error: "invalid_request" }, 400);
  const form = new URLSearchParams(raw);
  // Existing clients can repeat the same resource; reject ambiguous parameters.
  for (const name of new Set(form.keys())) {
    const values = form.getAll(name);
    if (values.length > 1 && (name !== "resource" || new Set(values).size !== 1)) return json({ error: "invalid_request" }, 400);
  }
  const grantType = form.get("grant_type");
  if (grantType && grantType !== "authorization_code" && grantType !== "refresh_token") return json({ error: "unsupported_grant_type" }, 400);
  const authorizationCode = form.get("code");
  const clientId = form.get("client_id");
  const redirectUri = form.get("redirect_uri");
  const verifier = form.get("code_verifier");
  const resource = form.get("resource");
  const issuer = new URL(request.url).origin;
  if (grantType === "refresh_token") {
    try { return await refreshOAuthSession(form, issuer, env); }
    catch { return json({ error: "temporarily_unavailable" }, 503); }
  }
  if (grantType !== "authorization_code" || !authorizationCode || !clientId || !redirectUri || !verifier || resource !== issuer + "/mcp") return json({ error: "invalid_request" }, 400);
  const codeObject = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName(authorizationCode));
  const codeUrl = "https://oauth-state.local/?key=" + encodeURIComponent(authorizationCode);
  const storedResponse = await codeObject.fetch(new Request(codeUrl, { method: "POST" }));
  if (!storedResponse.ok) return json({ error: "invalid_grant" }, 400);
  const stored = await storedResponse.json<{ value?: string }>();
  if (!stored.value) return json({ error: "invalid_grant" }, 400);
  const code = await verifyOAuthPayload(stored.value, env.OAUTH_SIGNING_SECRET);
  if (code?.kind !== "oauth_code" || code.iss !== issuer || code.code_id !== authorizationCode || code.client_id !== clientId || code.redirect_uri !== redirectUri || code.resource !== resource || typeof code.code_challenge !== "string") {
    return json({ error: "invalid_grant" }, 400);
  }
  if (!await verifyPkce(verifier, code.code_challenge)) return json({ error: "invalid_grant" }, 400);
  try { return await issueOAuthSession({
    iss: issuer,
    scope: "mcp:tools",
    aud: resource,
    github_id: code.github_id,
    github_login: code.github_login,
    client_id: clientId,
  }, env); } catch { return json({ error: "temporarily_unavailable" }, 503); }
}


async function handleInkboxTextEvent(request: Request, env: Env): Promise<Response> {
  const expected = `Bearer ${env.INKBOX_SMS_WEBHOOK_SECRET ?? ""}`;
  if (!env.INKBOX_SMS_WEBHOOK_SECRET || !constantEqual(request.headers.get("authorization") ?? "", expected)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "UNSUPPORTED_CONTENT_TYPE" }, 415);
  }
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 262144) return json({ error: "EVENT_TOO_LARGE" }, 413);
  let event: { type?: unknown; event_type?: unknown; id?: unknown; data?: unknown };
  try { event = JSON.parse(raw) as typeof event; } catch { return json({ error: "INVALID_JSON" }, 400); }
  const eventType = typeof event.type === "string" ? event.type : event.event_type;
  if (eventType !== "text.received") return json({ error: "UNSUPPORTED_EVENT" }, 422);
  return json({ accepted: true, event: "text.received", action: "OBSERVATION_ONLY", reply_sent: false }, 202);
}

type McpRole = "bionic" | "agent_b" | "agent_c" | "worker_zero" | "cursor" | "codex" | "claude_desktop";
type RpcId = string | number;
type RpcRequest = { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> };

const READ_TOOLS = ["worker_d_pilot_status", "worker_d_evidence_hash_calculate", "worker_d_artifact_inventory", "worker_d_evidence_compare", "worker_d_allowed_app_status"] as const;
const WRITE_TOOL = "worker_d_sandbox_text_write";
const TOOL_SCHEMAS: Record<string, { title: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean> }> = {
  worker_d_pilot_status: { title: "Worker D Pilot Status", description: "Report Worker D's bounded local status.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  worker_d_evidence_hash_calculate: { title: "Calculate Evidence Hash", description: "Hash one approved sandbox file.", inputSchema: { type: "object", properties: { relative_path: { type: "string", minLength: 1, maxLength: 512 } }, required: ["relative_path"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  worker_d_artifact_inventory: { title: "Inventory Approved Artifact", description: "Inventory an approved sandbox directory.", inputSchema: { type: "object", properties: { relative_root: { type: "string", maxLength: 512, default: "." }, max_files: { type: "integer", minimum: 1, maximum: 1000, default: 250 } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  worker_d_evidence_compare: { title: "Compare Evidence Facts", description: "Compare expected hash and byte count with local evidence.", inputSchema: { type: "object", properties: { relative_path: { type: "string", minLength: 1, maxLength: 512 }, expected_sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }, expected_byte_count: { type: "integer", minimum: 0 } }, required: ["relative_path", "expected_sha256", "expected_byte_count"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  worker_d_allowed_app_status: { title: "Allowed Desktop App Status", description: "Report whether a named desktop app is in the owner-gated allowlist. This tool never launches or controls an app.", inputSchema: { type: "object", properties: { app_name: { type: "string", maxLength: 128 } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  worker_d_sandbox_text_write: { title: "Write Worker D Sandbox Text", description: "Create or explicitly overwrite one bounded sandbox text artifact.", inputSchema: { type: "object", properties: { relative_path: { type: "string", minLength: 1, maxLength: 512 }, content: { type: "string", maxLength: 1048576 }, overwrite: { type: "boolean", default: false } }, required: ["relative_path", "content"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
};

async function handleMcp(request: Request, env: Env, pipe: DurableObjectStub): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const role = await authenticateMcp(request, env);
  if (!role) {
    const response = rpcError(null, -32001, "Unauthorized", 401);
    response.headers.set("WWW-Authenticate", "Bearer resource_metadata=\"" + new URL(request.url).origin + "/.well-known/oauth-protected-resource/mcp\", scope=\"mcp:tools\"");
    return response;
  }
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > Number(env.MCP_MAX_REQUEST_BYTES)) return rpcError(null, -32002, "Request too large", 413);
  let rpc: RpcRequest;
  try { rpc = JSON.parse(raw) as RpcRequest; } catch { return rpcError(null, -32700, "Parse error", 400); }
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return rpcError(rpc.id ?? null, -32600, "Invalid Request", 400);
  if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled") {
    if (rpc.method === "notifications/cancelled") await pipe.fetch(new Request("https://pipe/cancel", { method: "POST", body: JSON.stringify({ request_id: rpc.params?.requestId }) }));
    return new Response(null, { status: 202 });
  }
  if (rpc.id === undefined) return new Response(null, { status: 202 });
  if (rpc.method === "initialize") return rpcResult(rpc.id, { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "core-worker-d-gateway", version: "0.2.0" } });
  if (rpc.method === "ping") return rpcResult(rpc.id, {});
  if (rpc.method === "tools/list") {
    const allowed = role === "agent_c" ? [...READ_TOOLS] : [...READ_TOOLS, WRITE_TOOL];
    const peerTools = mailboxEnabled(env.MCP_PEER_MESSAGES_ENABLED, role, env.MCP_MAIN_OFFICE_MESSAGES_ENABLED)
      ? mailboxTools(role) : [];
    return rpcResult(rpc.id, { tools: [...allowed.map((name) => ({ name, ...TOOL_SCHEMAS[name] })), { name: "relay_inbox_status", description: "Read your authenticated OAuth client fingerprint and Main Office inbox binding. Does not grant access or send a message.", inputSchema: {type:"object",properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false} }, ...peerTools] });
  }
  if (rpc.method !== "tools/call") return rpcError(rpc.id, -32601, "Method not found");
  const name = rpc.params?.name;
  const args = rpc.params?.arguments ?? {};
  if (name === "relay_inbox_status") {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) return rpcError(rpc.id, -32602, "Invalid arguments");
    return rpcResult(rpc.id, { content: [{type:"text",text:JSON.stringify(await inboxStatus(request, env, role))}] });
  }
  if (typeof name === "string" && Object.hasOwn(MAILBOX_TOOLS, name)) {
    if (!mailboxEnabled(env.MCP_PEER_MESSAGES_ENABLED, role, env.MCP_MAIN_OFFICE_MESSAGES_ENABLED)) return rpcError(rpc.id, -32003, "Peer messaging is disabled or outside this principal's scope", 403);
    const mailbox = env.A2A_JOB.get(env.A2A_JOB.idFromName(role === "codex" || role === "claude_desktop" ? "main-office-mailbox-v1" : "peer-mailbox-v1"));
    const response = await mailbox.fetch(new Request("https://job/peer-message", { method: "POST", body: JSON.stringify({ actor: role, tool: name, args }) }));
    const result = await response.json();
    return rpcResult(rpc.id, { content: [{ type: "text", text: JSON.stringify(result) }], ...(!response.ok ? { isError: true } : {}) });
  }
  if (typeof name !== "string" || !(name in TOOL_SCHEMAS)) return rpcError(rpc.id, -32602, "Unknown or invalid tool");
  if (role === "agent_c" && name === WRITE_TOOL) return rpcError(rpc.id, -32003, "Tool is outside this principal's scope", 403);
  const requestId = crypto.randomUUID();
  const deadline = Date.now() + Number(env.MCP_CALL_TIMEOUT_MS);
  const response = await pipe.fetch(new Request("https://pipe/invoke", { method: "POST", body: JSON.stringify({ version: 1, request_id: requestId, principal: role, tool: name, arguments: args, deadline }) }));
  if (!response.ok) {
    const failure: { error?: string } = await response.json<{ error?: string }>().catch(() => ({}));
    return rpcError(rpc.id, response.status === 503 ? -32004 : -32000, failure.error ?? "Worker D invocation failed", response.status);
  }
  const text = await response.text();
  if (encoder.encode(text).byteLength > Number(env.MCP_MAX_RESULT_BYTES)) return rpcError(rpc.id, -32005, "Worker D result too large", 502);
  const result = JSON.parse(text);
  // Additive discovery metadata lets already-connected clients identify themselves
  // before their tool catalog is refreshed. No credentials or raw client IDs leave the relay.
  if (name === "worker_d_pilot_status") result.content = [...(result.content ?? []), {type:"text", text:JSON.stringify({relay_inbox:await inboxStatus(request, env, role)})}];
  return rpcResult(rpc.id, result);
}

async function inboxStatus(request: Request, env: Env, role: McpRole) {
  const token = (request.headers.get("authorization") ?? "").slice(7);
  const claims = await verifyOAuthPayload(token, env.OAUTH_SIGNING_SECRET);
  const client = claims?.kind === "oauth_access" && typeof claims.client_id === "string" ? claims.client_id : null;
  return {client_fingerprint:client ? await sha256Hex(client) : null, principal:role,
    enabled:mailboxEnabled(env.MCP_PEER_MESSAGES_ENABLED, role, env.MCP_MAIN_OFFICE_MESSAGES_ENABLED), delivery:"PULL_ONLY", execution_authorized:false};
}

async function authenticateMcp(request: Request, env: Env): Promise<McpRole | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const digest = await sha256Hex(header.slice(7));
  if (constantEqual(digest, env.BIONIC_MCP_TOKEN_SHA256 ?? "")) return "bionic";
  if (constantEqual(digest, env.AGENT_B_MCP_TOKEN_SHA256 ?? "")) return "agent_b";
  if (constantEqual(digest, env.AGENT_C_MCP_TOKEN_SHA256 ?? "")) return "agent_c";
  if (constantEqual(digest, env.WORKER_ZERO_MCP_TOKEN_SHA256 ?? "")) return "worker_zero";
  if (constantEqual(digest, env.CURSOR_MCP_TOKEN_SHA256 ?? "")) return "cursor";
  const oauth = await verifyOAuthPayload(header.slice(7), env.OAUTH_SIGNING_SECRET);
  const issuer = new URL(request.url).origin;
  if (oauth?.kind === "oauth_access" && oauth.iss === issuer && oauth.role === "cursor" && oauth.scope === "mcp:tools" && oauth.aud === issuer + "/mcp") {
    const fingerprint = typeof oauth.client_id === "string" ? await sha256Hex(oauth.client_id) : null;
    return inboxIdentity(fingerprint, env.MCP_CODEX_OAUTH_CLIENT_SHA256, env.MCP_CLAUDE_DESKTOP_OAUTH_CLIENT_SHA256) ?? "cursor";
  }
  return null;
}


async function sha256Hex(value: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value)); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function constantEqual(a: string, b: string): boolean { if (!a || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  const raw = await request.text();
  return encoder.encode(raw).byteLength <= maxBytes ? raw : null;
}
function redirectNoStore(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", pragma: "no-cache", "referrer-policy": "no-referrer" } });
}
function rpcResult(id: RpcId, result: unknown): Response { return json({ jsonrpc: "2.0", id, result }); }
function rpcError(id: RpcId | null, code: number, message: string, status = 200): Response { return json({ jsonrpc: "2.0", id, error: { code, message } }, status); }

export class MCPPipe {
  private readonly state: DurableObjectState;
  private socket: WebSocket | null = null;
  private degraded = false;
  private readonly pending = new Map<string, { resolve: (response: Response) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(state: DurableObjectState) { this.state = state; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status") return json({ online: this.socket?.readyState === WebSocket.OPEN, degraded: this.degraded });
    if (url.pathname === "/v1/connector" && request.headers.get("upgrade")?.toLowerCase() === "websocket") return this.connect();
    if (url.pathname === "/cancel" && request.method === "POST") {
      const body = await request.json<{ request_id?: string }>();
      if (body.request_id && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ version: 1, type: "cancel", request_id: body.request_id }));
      return json({ cancelled: true });
    }
    if (url.pathname === "/invoke" && request.method === "POST") return this.invoke(await request.text());
    return json({ error: "NOT_FOUND" }, 404);
  }

  private connect(): Response {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1012, "connector replaced");
    const pair = new WebSocketPair();
    const client = pair[0]; const server = pair[1];
    server.accept(); this.socket = server; this.degraded = false;
    server.addEventListener("message", (event) => this.onMessage(String(event.data)));
    server.addEventListener("close", () => { if (this.socket === server) this.socket = null; this.failAll("Worker D connector disconnected"); });
    server.addEventListener("error", () => { this.degraded = true; this.failAll("Worker D connector failed"); });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async invoke(raw: string): Promise<Response> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return json({ error: "Worker D offline" }, 503);
    const message = JSON.parse(raw) as { request_id: string; deadline: number };
    if (!message.request_id || message.deadline <= Date.now()) return json({ error: "Invocation expired" }, 408);
    if (this.pending.has(message.request_id)) return json({ error: "Duplicate invocation" }, 409);
    return new Promise<Response>((resolve) => {
      const wait = Math.max(1, Math.min(message.deadline - Date.now(), 30000));
      const timer = setTimeout(() => { this.pending.delete(message.request_id); resolve(json({ error: "Worker D timeout" }, 504)); }, wait);
      this.pending.set(message.request_id, { resolve, timer });
      this.socket!.send(JSON.stringify({ version: 1, type: "invoke", ...message }));
    });
  }

  private onMessage(raw: string): void {
    let message: { type?: string; request_id?: string; result?: unknown; error?: string; degraded?: boolean };
    try { message = JSON.parse(raw) as typeof message; } catch { return; }
    if (message.type === "status") { this.degraded = Boolean(message.degraded); return; }
    if (message.type !== "result" || !message.request_id) return;
    const pending = this.pending.get(message.request_id); if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.request_id);
    pending.resolve(message.error ? json({ error: message.error }, 502) : json(message.result));
  }

  private failAll(reason: string): void { for (const [id, item] of this.pending) { clearTimeout(item.timer); item.resolve(json({ error: reason }, 503)); this.pending.delete(id); } }
}

export class OAuthState {
  private readonly state: DurableObjectState;
  constructor(state: DurableObjectState) { this.state = state; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/refresh/create" || url.pathname === "/refresh/rotate") return refreshFamilyRequest(request, this.state.storage);
    const key = url.searchParams.get("key");
    if (!key || !/^[A-Za-z0-9._-]{16,256}$/.test(key)) return json({ error: "INVALID_STATE_KEY" }, 400);
    if (request.method === "PUT") {
      const ttl = Math.min(600, Math.max(30, Number(url.searchParams.get("ttl") ?? 300)));
      await this.state.storage.put(key, { value: await request.text(), expires: Date.now() + ttl * 1000 });
      return json({ stored: true }, 201);
    }
    if (request.method === "GET") {
      const item = await this.state.storage.get<{ value: string; expires: number }>(key);
      if (!item || item.expires <= Date.now()) { await this.state.storage.delete(key); return json({ found: false }, 404); }
      return json({ found: true, value: item.value }, 200);
    }
    if (request.method === "POST") {
      const item = await this.state.storage.transaction(async tx => {
        const value = await tx.get<{ value: string; expires: number }>(key);
        await tx.delete(key);
        return value && value.expires > Date.now() ? value : null;
      });
      return item ? json({ found: true, value: item.value }, 200) : json({ found: false }, 404);
    }
    if (request.method === "DELETE") return json({ deleted: await this.state.storage.delete(key) }, 200);
    return new Response(null, { status: 405, headers: { allow: "GET, PUT, POST, DELETE" } });
  }

  async alarm(): Promise<void> {
    await this.state.storage.transaction(async tx => {
      const family = await tx.get<{ expires: number }>("refresh-family");
      if (family && family.expires * 1000 <= Date.now()) await tx.delete("refresh-family");
      else if (family) await tx.setAlarm(family.expires * 1000);
    });
  }
}

function authenticate(request: Request, env: Env): "n8n" | "connector" | null {
  const value = request.headers.get("authorization") ?? "";
  if (value === `Bearer ${env.N8N_SHARED_SECRET}`) return "n8n";
  if (value === `Bearer ${env.CONNECTOR_SHARED_SECRET}`) return "connector";
  return null;
}

async function createJob(request: Request, env: Env): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > Number(env.MAX_JOB_BYTES)) return json({ error: "JOB_TOO_LARGE" }, 413);
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > Number(env.MAX_JOB_BYTES)) return json({ error: "JOB_TOO_LARGE" }, 413);
  let input: { schema_version?: string; correlation_id?: string; idempotency_key?: string; payload?: unknown };
  try { input = JSON.parse(raw) as typeof input; } catch { return json({ error: "INVALID_JSON" }, 400); }
  if (input.schema_version !== "core.a2a.relay-job.v1" || !input.correlation_id || !input.idempotency_key) return json({ error: "INVALID_RELAY_JOB" }, 400);
  const id = env.A2A_JOB.idFromName(input.idempotency_key);
  const stub = env.A2A_JOB.get(id);
  const response = await stub.fetch(new Request("https://job/create", { method: "POST", body: JSON.stringify({ id: id.toString(), correlation_id: input.correlation_id, idempotency_key: input.idempotency_key, payload: input.payload }) }));
  const queue = env.A2A_JOB.get(env.A2A_JOB.idFromName("queue"));
  await queue.fetch(new Request("https://job/enqueue", { method: "POST", body: await response.clone().text() }));
  return response;
}

async function leaseJob(env: Env): Promise<Response> {
  const id = env.A2A_JOB.newUniqueId();
  // The coordinator is a single durable object used only for the pending queue.
  const stub = env.A2A_JOB.get(env.A2A_JOB.idFromName("queue"));
  return stub.fetch(new Request("https://job/lease", { method: "POST", body: JSON.stringify({ lease_id: id.toString(), ttl: Number(env.JOB_TTL_SECONDS) }) }));
}

async function completeJob(id: string, request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > Number(env.MAX_JOB_BYTES)) return json({ error: "RESULT_TOO_LARGE" }, 413);
  const stub = env.A2A_JOB.get(env.A2A_JOB.idFromString(id));
  return stub.fetch(new Request("https://job/complete", { method: "POST", body: raw }));
}

async function readJob(id: string, env: Env): Promise<Response> {
  const stub = env.A2A_JOB.get(env.A2A_JOB.idFromString(id));
  return stub.fetch(new Request("https://job/read"));
}

export class A2AJob {
  readonly state: DurableObjectState;
  readonly env: Env;
  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/candidate-intake/')) return intakeFetch(request,this.state.storage,this.env);
    if (url.pathname.startsWith('/dispatcher/')) return dispatcherFetch(request,this.state.storage,this.env);
    if (request.method === "POST" && url.pathname === "/peer-message") {
      const input = await request.json() as { actor: string; tool: string; args: unknown };
      if (!mailboxEnabled(this.env.MCP_PEER_MESSAGES_ENABLED, input.actor, this.env.MCP_MAIN_OFFICE_MESSAGES_ENABLED)) return json({ error: "PEER_MESSAGES_DISABLED" }, 403);
      try {
        const result = await this.state.storage.transaction(async tx => {
          const value = await mailboxCall(tx, input.actor, input.tool, input.args);
          if (await tx.getAlarm() === null) await tx.setAlarm(Date.now() + 900_000);
          return value;
        });
        return json(result);
      } catch (error) {
        const known = new Set(["PRINCIPAL_NOT_ALLOWED", "UNKNOWN_TOOL", "INVALID_ARGUMENTS", "INVALID_RECIPIENT", "IDEMPOTENCY_CONFLICT", "MAILBOX_FULL", "MESSAGE_NOT_FOUND_OR_EXPIRED", "RECIPIENT_ONLY", "REPLY_CONFLICT"]);
        const message = error instanceof Error && known.has(error.message) ? error.message : "MAILBOX_UNAVAILABLE";
        return json({ error: message }, message === "MAILBOX_UNAVAILABLE" ? 503 : 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/create") return this.create(await request.json() as Partial<Job>);
    if (request.method === "POST" && url.pathname === "/enqueue") return this.enqueue(await request.json() as Job);
    if (request.method === "POST" && url.pathname === "/lease") return this.lease(await request.json() as { lease_id: string; ttl: number });
    if (request.method === "POST" && url.pathname === "/complete") return this.complete(await request.json() as { state: JobState; result?: unknown });
    if (request.method === "GET" && url.pathname === "/read") return json(await this.read());
    return json({ error: "NOT_FOUND" }, 404);
  }

  async alarm(): Promise<void> {
    if(await this.state.storage.get('intake-owned')) { await intakeAlarm(this.state.storage,this.env); return; }
    await this.state.storage.transaction(async tx => {
      const messages = (await tx.get<import("./mailbox").Message[]>("peer-messages") ?? []).filter(m => m.expires_at > Date.now());
      if (messages.length) {
        await tx.put("peer-messages", messages);
        await tx.setAlarm(Math.min(...messages.map(m => m.expires_at)));
      } else await tx.delete("peer-messages");
    });
  }

  async create(input: Partial<Job>): Promise<Response> {
    const existing = await this.state.storage.get<Job>("job");
    if (existing) return json(existing, 200);
    const job: Job = { id: String(input.id), correlation_id: String(input.correlation_id), idempotency_key: String(input.idempotency_key), payload: input.payload, state: "PENDING", created_at: new Date().toISOString() };
    await this.state.storage.put("job", job);
    return json(job, 201);
  }

  async enqueue(job: Job): Promise<Response> {
    if (!job.id || !job.idempotency_key) return json({ error: "INVALID_JOB" }, 400);
    await this.state.storage.put(`job:${job.id}`, job);
    return json({ queued: true, id: job.id });
  }

  async lease(input: { lease_id: string; ttl: number }): Promise<Response> {
    const keys = await this.state.storage.list<Job>({ prefix: "job:" });
    for (const [key, job] of keys) {
      if (job.state !== "PENDING" || key === "job:queue") continue;
      job.state = "LEASED"; job.lease_until = new Date(Date.now() + input.ttl * 1000).toISOString();
      await this.state.storage.put(key, job);
      return json(job);
    }
    return new Response(null, { status: 204 });
  }

  async complete(input: { state: JobState; result?: unknown }): Promise<Response> {
    const job = await this.state.storage.get<Job>("job");
    if (!job) return json({ error: "JOB_NOT_FOUND" }, 404);
    if (job.state === "COMPLETED" || job.state === "HELD") return json(job);
    if (!["COMPLETED", "HELD"].includes(input.state)) return json({ error: "INVALID_TERMINAL_STATE" }, 400);
    job.state = input.state; job.result = input.result;
    await this.state.storage.put("job", job);
    return json(job);
  }

  async read(): Promise<Job | { error: string }> { return await this.state.storage.get<Job>("job") ?? { error: "JOB_NOT_FOUND" }; }
}

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
