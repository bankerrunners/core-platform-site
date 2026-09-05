import { signOAuthPayload, verifyOAuthPayload } from "./oauth.ts";

export const REFRESH_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const SCOPE = "mcp:tools";
interface Binding { iss: string; client_id: string; aud: string; github_id: number; github_login: string; scope: string }
interface Family { binding: string; current: string; expires: number; revoked: boolean }
interface RefreshEnv { OAUTH_SIGNING_SECRET: string; OAUTH_STATE: DurableObjectNamespace; GITHUB_ALLOWED_LOGIN: string }
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" },
});
async function bindingHash(binding: Binding): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(binding)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function bindingFrom(value: Record<string, unknown>): Binding | null {
  if (typeof value.iss !== "string" || typeof value.client_id !== "string" || typeof value.aud !== "string"
    || !Number.isSafeInteger(value.github_id) || Number(value.github_id) <= 0 || typeof value.github_login !== "string"
    || !value.github_login || value.scope !== SCOPE) return null;
  return { iss: value.iss, client_id: value.client_id, aud: value.aud, github_id: Number(value.github_id), github_login: value.github_login, scope: SCOPE };
}
async function tokens(binding: Binding, family: string, jti: string, expires: number, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const lifetime = Math.min(3600, expires - now);
  if (lifetime <= 0) throw new Error("expired refresh session");
  return {
    access_token: await signOAuthPayload({ ...binding, kind: "oauth_access", role: "cursor", iat: now, exp: now + lifetime }, secret),
    refresh_token: await signOAuthPayload({ ...binding, kind: "oauth_refresh", family, jti, iat: now, exp: expires }, secret),
    token_type: "Bearer", expires_in: lifetime, scope: SCOPE,
  };
}
export async function issueOAuthSession(value: Record<string, unknown>, env: RefreshEnv): Promise<Response> {
  const binding = bindingFrom(value);
  if (!binding || binding.github_login.toLowerCase() !== env.GITHUB_ALLOWED_LOGIN.toLowerCase()) return reply({ error: "invalid_grant" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const client = await verifyOAuthPayload(binding.client_id, env.OAUTH_SIGNING_SECRET);
  if (client?.kind !== "oauth_client" || client.iss !== binding.iss) return reply({ error: "invalid_client" }, 400);
  const expires = Math.min(now + REFRESH_LIFETIME_SECONDS, Number(client.exp));
  const family = crypto.randomUUID(), jti = crypto.randomUUID();
  const result = await tokens(binding, family, jti, expires, env.OAUTH_SIGNING_SECRET);
  const stub = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName("refresh:" + family));
  const stored = await stub.fetch(new Request("https://oauth-state.local/refresh/create", { method: "POST", body: JSON.stringify({ binding: await bindingHash(binding), current: jti, expires, revoked: false }) }));
  return stored.ok ? reply(result) : reply({ error: "temporarily_unavailable" }, 503);
}
export async function refreshOAuthSession(form: URLSearchParams, issuer: string, env: RefreshEnv): Promise<Response> {
  const raw = form.get("refresh_token"), clientId = form.get("client_id");
  if (!raw || !clientId) return reply({ error: "invalid_request" }, 400);
  const claims = await verifyOAuthPayload(raw, env.OAUTH_SIGNING_SECRET);
  const binding = claims && bindingFrom(claims);
  if (!claims || !binding || claims.kind !== "oauth_refresh" || binding.iss !== issuer || binding.aud !== issuer + "/mcp"
    || binding.client_id !== clientId || binding.github_login.toLowerCase() !== env.GITHUB_ALLOWED_LOGIN.toLowerCase()
    || typeof claims.family !== "string" || !/^[a-f0-9-]{36}$/.test(claims.family)
    || typeof claims.jti !== "string" || !/^[a-f0-9-]{36}$/.test(claims.jti)) return reply({ error: "invalid_grant" }, 400);
  // Resource can be omitted on refresh; it then retains the original audience.
  if (form.has("resource") && form.get("resource") !== binding.aud) return reply({ error: "invalid_target" }, 400);
  if (form.has("scope") && form.get("scope") !== binding.scope) return reply({ error: "invalid_scope" }, 400);
  const client = await verifyOAuthPayload(clientId, env.OAUTH_SIGNING_SECRET);
  if (client?.kind !== "oauth_client" || client.iss !== issuer) return reply({ error: "invalid_client" }, 400);
  const next = crypto.randomUUID();
  const result = await tokens(binding, claims.family, next, Number(claims.exp), env.OAUTH_SIGNING_SECRET);
  const stub = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName("refresh:" + claims.family));
  const rotated = await stub.fetch(new Request("https://oauth-state.local/refresh/rotate", { method: "POST", body: JSON.stringify({ binding: await bindingHash(binding), current: claims.jti, next, expires: claims.exp }) }));
  if (!rotated.ok) return reply({ error: rotated.status === 400 ? "invalid_grant" : "temporarily_unavailable" }, rotated.status === 400 ? 400 : 503);
  return reply(result);
}

// Only reached through the internal DO binding, never routed from a public URL.
export async function refreshFamilyRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "invalid_request" }, 405);
  const input = await request.json() as Family & { next?: string };
  const create = new URL(request.url).pathname === "/refresh/create";
  if (!/^[a-f0-9]{64}$/.test(input.binding ?? "") || !/^[a-f0-9-]{36}$/.test(input.current ?? "")
    || !Number.isSafeInteger(input.expires) || input.expires <= Math.floor(Date.now()/1000)
    || input.expires > Math.floor(Date.now()/1000) + REFRESH_LIFETIME_SECONDS
    || (!create && !/^[a-f0-9-]{36}$/.test(input.next ?? ""))) return reply({ error: "invalid_grant" }, 400);
  const ok = await storage.transaction(async tx => {
    const family = await tx.get<Family>("refresh-family");
    if (create) {
      if (family) return false;
      await tx.put("refresh-family", { binding: input.binding, current: input.current, expires: input.expires, revoked: false });
      await tx.setAlarm(input.expires * 1000);
      return true;
    }
    if (!family || family.revoked || family.expires <= Math.floor(Date.now()/1000)
      || family.binding !== input.binding || family.expires !== input.expires) return false;
    if (family.current !== input.current) {
      await tx.put("refresh-family", { ...family, revoked: true });
      return false;
    }
    await tx.put("refresh-family", { ...family, current: input.next! });
    return true;
  });
  return reply(ok ? { ok: true } : { error: "invalid_grant" }, ok ? 200 : 400);
}
