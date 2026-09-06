const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signOAuthPayload(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return body + "." + base64url(new Uint8Array(signature));
}
export async function verifyOAuthPayload(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const body = parts[0], encodedSignature = parts[1];
  if (!body || !encodedSignature) return null;
  let signature: Uint8Array;
  try { signature = fromBase64url(encodedSignature); } catch { return null; }
  if (!await crypto.subtle.verify("HMAC", await key(secret), signature as unknown as BufferSource, encoder.encode(body))) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Record<string, unknown>;
    return typeof value.exp === "number" && value.exp > Math.floor(Date.now() / 1000) ? value : null;
  } catch { return null; }
}

export async function verifyPkce(codeVerifier: string, expectedChallenge: string): Promise<boolean> {
  if (!codeVerifier || !expectedChallenge) return false;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  return base64url(new Uint8Array(digest)) === expectedChallenge;
}

export function validOAuthRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1");
  } catch { return false; }
}

export function matchesRegisteredOAuthRedirect(
  requested: string,
  registered: string[],
  applicationType: unknown,
): boolean {
  if (registered.includes(requested)) return true;
  if (applicationType !== "native" || !validOAuthRedirect(requested)) return false;

  let requestedUrl: URL;
  try { requestedUrl = new URL(requested); } catch { return false; }
  const isLoopback = requestedUrl.protocol === "http:"
    && (requestedUrl.hostname === "127.0.0.1" || requestedUrl.hostname === "localhost" || requestedUrl.hostname === "::1");
  if (!isLoopback || requestedUrl.pathname !== "/callback" || requestedUrl.search || requestedUrl.hash) return false;

  return registered.some((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:"
        && url.hostname === "www.cursor.com"
        && url.pathname === "/agents/mcp/oauth/callback"
        && !url.search
        && !url.hash;
    } catch {
      return false;
    }
  });
}

export function oauthAuthorizationMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: origin + "/oauth/authorize",
    token_endpoint: origin + "/oauth/token",
    registration_endpoint: origin + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:tools"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function oauthProtectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: origin + "/mcp",
    authorization_servers: [origin],
    scopes_supported: ["mcp:tools"],
    bearer_methods_supported: ["header"],
  };
}
