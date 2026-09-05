import test from "node:test";
import assert from "node:assert/strict";
import worker, { OAuthState, type Env } from "../src/index.ts";
import { signOAuthPayload, verifyOAuthPayload } from "../src/oauth.ts";
import { REFRESH_LIFETIME_SECONDS } from "../src/oauth-refresh.ts";

const origin = "https://relay.example";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const redirect = "http://127.0.0.1:12345/callback";
async function fixture(t: any) {
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  const stores = new Map<string, any>();
  let unavailable = "";
  let failWrite = false, loseResponse = false;
  const namespace = {
    idFromName: (id: string) => id,
    get(id: string) {
      if (!stores.has(id)) {
        const data = new Map<string, any>();
        let pending = Promise.resolve();
        const storage: any = {
          get: async (key: string) => structuredClone(data.get(key)),
          put: async (key: string, value: any) => {
            data.set(key, structuredClone(value));
            if (failWrite && key === "refresh-family") throw Error("simulated write failure");
          },
          delete: async (key: string) => data.delete(key),
          setAlarm: async (when: number) => { storage.alarm = when; },
          transaction(fn: any) {
            const result = pending.then(async () => {
              const snapshot = structuredClone(data), alarm = storage.alarm;
              try { return await fn(storage); }
              catch (error) { data.clear(); for (const [k,v] of snapshot) data.set(k,v); storage.alarm=alarm; throw error; }
            });
            pending = result.then(() => {}, () => {});
            return result;
          },
        };
        stores.set(id, { data, storage, object: new OAuthState({ storage } as never) });
      }
      return { fetch: async (r: Request) => {
        if (unavailable && new URL(r.url).pathname === unavailable) throw Error("simulated storage failure");
        const response = await stores.get(id).object.fetch(r);
        if (loseResponse && new URL(r.url).pathname === "/refresh/rotate") throw Error("simulated lost response after commit");
        return response;
      } };
    },
  };
  const env = {
    OAUTH_SIGNING_SECRET: "unit-test-secret-never-production-123456", OAUTH_STATE: namespace,
    GITHUB_CLIENT_ID: "test", GITHUB_CLIENT_SECRET: "test", GITHUB_ALLOWED_LOGIN: "owner",
    MCP_MAX_REQUEST_BYTES: "1048576", MCP_MAIN_OFFICE_MESSAGES_ENABLED: "true",
    MCP_PIPE: { idFromName: (id: string) => id, get: () => ({ fetch: () => { throw Error("unexpected Worker D invocation"); } }) },
  } as unknown as Env;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "fixture-only" });
    if (url === "https://api.github.com/user") return Response.json({ id: 123, login: "owner" });
    throw Error("unexpected external fetch");
  });
  async function post(path: string, fields: Record<string, string>) {
    const response = await worker.fetch(new Request(origin + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) }), env);
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  }
  const registration = await worker.fetch(new Request(origin + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirect], application_type: "native" }) }), env);
  const client = (await registration.json() as any).client_id;
  const digest = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");
  env.MCP_CODEX_OAUTH_CLIENT_SHA256 = await digest(client);
  env.MCP_CLAUDE_DESKTOP_OAUTH_CLIENT_SHA256 = await digest("distinct-desktop-fixture");
  async function code() {
    const params = new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", resource: origin + "/mcp", scope: "mcp:tools", state: "owner-state" });
    const auth = await worker.fetch(new Request(origin + "/oauth/authorize?" + params), env);
    assert.equal(auth.status, 302);
    const state = new URL(auth.headers.get("location")!).searchParams.get("state")!;
    const callback = await worker.fetch(new Request(origin + "/oauth/github/callback?" + new URLSearchParams({ state, code: "fixture-code" })), env);
    assert.equal(callback.status, 302);
    const location = new URL(callback.headers.get("location")!);
    assert.equal(location.searchParams.get("state"), "owner-state");
    return location.searchParams.get("code")!;
  }
  const exchange = (c: string, overrides = {}) => post("/oauth/token", { grant_type: "authorization_code", client_id: client, redirect_uri: redirect, code_verifier: verifier, resource: origin + "/mcp", code: c, ...overrides });
  const refresh = (token: string, overrides = {}) => post("/oauth/token", { grant_type: "refresh_token", client_id: client, refresh_token: token, ...overrides });
  async function rpc(token: string, method = "tools/list") {
    const response = await worker.fetch(new Request(origin + "/mcp", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { name: "relay_inbox_status", arguments: {} } }) }), env);
    return { status: response.status, body: await response.json() as any };
  }
  return { env, client, stores, code, exchange, refresh, rpc, post, advance: (seconds: number) => { now += seconds * 1000; }, fail: (path: string) => { unavailable = path; }, writeFailure: (v:boolean)=>{failWrite=v;}, lostResponse:(v:boolean)=>{loseResponse=v;} };
}

test("full PKCE login, access expiry, refresh and stable exact-client inbox discovery", async t => {
  const f = await fixture(t);
  const result = await f.exchange(await f.code());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("pragma"), "no-cache");
  assert.equal(result.body.expires_in, 3600);
  const first = await verifyOAuthPayload(result.body.refresh_token, f.env.OAUTH_SIGNING_SECRET);
  assert.equal(first!.exp, Math.floor(Date.now()/1000) + REFRESH_LIFETIME_SECONDS);
  assert.equal((await f.rpc(result.body.access_token)).body.result.tools.length, 11);
  assert.equal((await f.rpc(result.body.refresh_token)).status, 401);
  f.advance(3601);
  assert.equal((await f.rpc(result.body.access_token)).status, 401);
  const renewed = await f.refresh(result.body.refresh_token, { resource: origin + "/mcp", scope: "mcp:tools" });
  assert.equal(renewed.status, 200);
  assert.notEqual(renewed.body.refresh_token, result.body.refresh_token);
  const second = await verifyOAuthPayload(renewed.body.refresh_token, f.env.OAUTH_SIGNING_SECRET);
  for (const name of ["client_id", "github_id", "github_login", "iss", "aud", "scope", "family", "exp"]) assert.equal(second![name], first![name]);
  const identity = JSON.parse((await f.rpc(renewed.body.access_token, "tools/call")).body.result.content[0].text);
  assert.equal(identity.principal, "codex");
  assert.equal(identity.enabled, true);
  assert.equal(identity.client_fingerprint, f.env.MCP_CODEX_OAUTH_CLIENT_SHA256);
  assert.equal((await f.refresh(renewed.body.refresh_token)).status, 200); // resource omitted retains audience
});

test("replayed or concurrently reused refresh token revokes its successor family", async t => {
  const f = await fixture(t);
  const initial = (await f.exchange(await f.code())).body;
  const results = await Promise.all([f.refresh(initial.refresh_token), f.refresh(initial.refresh_token)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  const winner = results.find(r => r.status === 200)!;
  assert.equal((await f.refresh(winner.body.refresh_token)).body.error, "invalid_grant");
  const independent = await f.exchange(await f.code());
  assert.equal((await f.refresh(independent.body.refresh_token)).status, 200);
});

test("binding violations and tampering fail without consuming the valid token", async t => {
  const f = await fixture(t);
  const initial = (await f.exchange(await f.code())).body;
  for (const [overrides, error] of [[{client_id:"other"}, "invalid_grant"], [{resource:"https://other/mcp"},"invalid_target"], [{scope:"mcp:tools admin"},"invalid_scope"], [{scope:""},"invalid_scope"]] as const) {
    assert.equal((await f.refresh(initial.refresh_token, overrides)).body.error, error);
  }
  assert.equal((await f.refresh(initial.refresh_token + "x")).status, 400);
  assert.equal((await f.refresh(initial.access_token)).status, 400);
  assert.equal((await f.refresh(f.client)).status, 400);
  const claims = (await verifyOAuthPayload(initial.refresh_token, f.env.OAUTH_SIGNING_SECRET))!;
  for (const override of [{iss:"https://other"},{aud:"https://other/mcp"},{github_id:999},{github_login:"attacker"},{scope:"admin"},{client_id:"other"}]) {
    const altered = await signOAuthPayload({...claims,...override}, f.env.OAUTH_SIGNING_SECRET);
    assert.equal((await f.refresh(altered)).status, 400);
  }
  f.env.GITHUB_ALLOWED_LOGIN = "changed-owner";
  assert.equal((await f.refresh(initial.refresh_token)).status, 400);
  f.env.GITHUB_ALLOWED_LOGIN = "owner";
  assert.equal((await f.refresh(initial.refresh_token)).status, 200);
});

test("failed transactional write rolls back, while retry after lost committed response revokes family", async t => {
  const f = await fixture(t);
  const initial = (await f.exchange(await f.code())).body;
  const claims = (await verifyOAuthPayload(initial.refresh_token,f.env.OAUTH_SIGNING_SECRET))!;
  const data = f.stores.get("refresh:"+claims.family).data;
  f.writeFailure(true);
  assert.equal((await f.refresh(initial.refresh_token)).status,503);
  assert.equal(data.get("refresh-family").current,claims.jti);
  f.writeFailure(false);
  f.lostResponse(true);
  assert.equal((await f.refresh(initial.refresh_token)).status,503);
  assert.notEqual(data.get("refresh-family").current,claims.jti);
  f.lostResponse(false);
  assert.equal((await f.refresh(initial.refresh_token)).status,400);
  assert.equal(data.get("refresh-family").revoked,true);
});

test("missing family state and invalid signed expiry/type fail closed", async t => {
  const f = await fixture(t);
  const initial = (await f.exchange(await f.code())).body;
  const claims = (await verifyOAuthPayload(initial.refresh_token,f.env.OAUTH_SIGNING_SECRET))!;
  for (const overrides of [{exp:0},{exp:"forever"},{exp:Infinity},{kind:"oauth_code"},{kind:"oauth_transaction"}]) {
    const token=await signOAuthPayload({...claims,...overrides},f.env.OAUTH_SIGNING_SECRET);
    assert.equal((await f.refresh(token)).status,400);
  }
  f.stores.get("refresh:"+claims.family).data.clear();
  assert.equal((await f.refresh(initial.refresh_token)).status,400);
});

test("refresh family absolute expiry is finite, rotation cannot slide it, alarm cleans it", async t => {
  const f = await fixture(t);
  const initial = (await f.exchange(await f.code())).body;
  const claims = (await verifyOAuthPayload(initial.refresh_token, f.env.OAUTH_SIGNING_SECRET))!;
  const record = f.stores.get("refresh:" + claims.family);
  assert.equal(record.storage.alarm, Number(claims.exp) * 1000);
  await record.object.alarm();
  assert.equal(record.data.has("refresh-family"), true);
  f.advance(REFRESH_LIFETIME_SECONDS - 10);
  const last = await f.refresh(initial.refresh_token);
  assert.equal(last.body.expires_in, 10);
  f.advance(10);
  assert.equal((await f.refresh(last.body.refresh_token)).body.error, "invalid_grant");
  assert.equal((await f.rpc(last.body.access_token)).status, 401);
  await record.object.alarm();
  assert.equal(record.data.has("refresh-family"), false);
});

test("authorization code is single-use even under parallel exchange and invalid PKCE", async t => {
  const f = await fixture(t);
  const c = await f.code();
  const results = await Promise.all([f.exchange(c), f.exchange(c)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200,400]);
  const invalid = await f.code();
  assert.equal((await f.exchange(invalid,{code_verifier:"wrong"})).status,400);
  assert.equal((await f.exchange(invalid)).status,400);
});

test("refresh persistence failures fail closed and do not return minted tokens", async t => {
  const f = await fixture(t);
  f.fail("/refresh/create");
  const failed = await f.exchange(await f.code());
  assert.equal(failed.status,503);
  assert.equal(failed.body.access_token,undefined);
  f.fail("");
  const initial = (await f.exchange(await f.code())).body;
  f.fail("/refresh/rotate");
  const rotation = await f.refresh(initial.refresh_token);
  assert.equal(rotation.status,503);
  assert.equal(rotation.body.refresh_token,undefined);
  f.fail("");
  assert.equal((await f.refresh(initial.refresh_token)).status,200);
});

test("metadata advertises refresh and ambiguous token parameters are rejected", async t => {
  const f = await fixture(t);
  const meta = await worker.fetch(new Request(origin+"/.well-known/oauth-authorization-server"),f.env);
  assert.deepEqual((await meta.json() as any).grant_types_supported,["authorization_code","refresh_token"]);
  const result = await worker.fetch(new Request(origin+"/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"grant_type=refresh_token&grant_type=authorization_code"}),f.env);
  assert.equal(result.status,400);
  assert.equal((await f.post("/oauth/token",{grant_type:"refresh_token"})).status,400);
  assert.equal((await f.post("/oauth/token",{grant_type:"password"})).body.error,"unsupported_grant_type");
});
