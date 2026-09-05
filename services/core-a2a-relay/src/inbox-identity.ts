// Only call after verifying the OAuth signature, issuer, audience, scope and expiry.
// Client names, tool arguments and request headers cannot choose an inbox identity.
export function inboxIdentity(clientId: unknown, codexId?: string, claudeId?: string): "codex" | "claude_desktop" | null {
  if (!codexId?.trim() || !claudeId?.trim() || codexId === claudeId) return null;
  if (typeof clientId !== "string") return null;
  if (clientId === codexId) return "codex";
  if (clientId === claudeId) return "claude_desktop";
  return null;
}
