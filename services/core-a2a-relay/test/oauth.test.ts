import test from "node:test";
import assert from "node:assert/strict";
import { matchesRegisteredOAuthRedirect, oauthAuthorizationMetadata, oauthProtectedResourceMetadata, signOAuthPayload, verifyOAuthPayload, verifyPkce, validOAuthRedirect } from "../src/oauth.ts";

test("signed OAuth payload verifies before expiry", async () => {
  const token = await signOAuthPayload({ exp: Math.floor(Date.now() / 1000) + 60, subject: "cursor" }, "test-secret");
  assert.equal((await verifyOAuthPayload(token, "test-secret"))?.subject, "cursor");
});

test("tampered and expired OAuth payloads are rejected", async () => {
  const token = await signOAuthPayload({ exp: Math.floor(Date.now() / 1000) + 60 }, "test-secret");
  assert.equal(await verifyOAuthPayload(token + "x", "test-secret"), null);
  assert.equal(await verifyOAuthPayload(token + ".extra", "test-secret"), null);
  const expired = await signOAuthPayload({ exp: Math.floor(Date.now() / 1000) - 1 }, "test-secret");
  assert.equal(await verifyOAuthPayload(expired, "test-secret"), null);
});

test("PKCE S256 challenge verifies", async () => {
  assert.equal(await verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), true);
  assert.equal(await verifyPkce("wrong", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), false);
});

test("OAuth redirects allow HTTPS and loopback HTTP only", () => {
  assert.equal(validOAuthRedirect("https://cursor.com/oauth/callback"), true);
  assert.equal(validOAuthRedirect("http://127.0.0.1:49152/callback"), true);
  assert.equal(validOAuthRedirect("http://localhost:49152/callback"), true);
  assert.equal(validOAuthRedirect("http://example.com/callback"), false);
  assert.equal(validOAuthRedirect("https://user:pass@example.com/callback"), false);
  assert.equal(validOAuthRedirect("https://example.com/callback#fragment"), false);
});

test("Cursor native clients may exchange the official cloud callback for a bounded loopback callback", () => {
  const cursorCloud = ["https://www.cursor.com/agents/mcp/oauth/callback"];
  assert.equal(matchesRegisteredOAuthRedirect("http://localhost:8787/callback", cursorCloud, "native"), true);
  assert.equal(matchesRegisteredOAuthRedirect("http://127.0.0.1:49152/callback", cursorCloud, "native"), true);
  assert.equal(matchesRegisteredOAuthRedirect("http://localhost:8787/other", cursorCloud, "native"), false);
  assert.equal(matchesRegisteredOAuthRedirect("http://localhost:8787/callback?next=bad", cursorCloud, "native"), false);
  assert.equal(matchesRegisteredOAuthRedirect("http://localhost:8787/callback", cursorCloud, "web"), false);
  assert.equal(matchesRegisteredOAuthRedirect("http://localhost:8787/callback", ["https://example.com/callback"], "native"), false);
});

test("OAuth metadata advertises code flow with PKCE and the MCP resource", () => {
  const origin = "https://relay.example";
  const authorization = oauthAuthorizationMetadata(origin);
  const resource = oauthProtectedResourceMetadata(origin);
  assert.equal(authorization.authorization_endpoint, origin + "/oauth/authorize");
  assert.deepEqual(authorization.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(authorization.scopes_supported, ["mcp:tools"]);
  assert.equal(authorization.authorization_response_iss_parameter_supported, true);
  assert.equal(resource.resource, origin + "/mcp");
  assert.deepEqual(resource.authorization_servers, [origin]);
  assert.deepEqual(resource.scopes_supported, ["mcp:tools"]);
});
