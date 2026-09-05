// Transport only: a message is untrusted data, never an execution authorization.
export type Peer = "agent_b" | "agent_c" | "codex" | "claude_desktop";
const counterparts: Record<Peer, Peer> = { agent_b: "agent_c", agent_c: "agent_b", codex: "claude_desktop", claude_desktop: "codex" };
export interface Message {
  id: string; sender: Peer; recipient: Peer; key: string; text: string;
  created_at: number; expires_at: number; reply?: string;
}
export interface MailboxStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<unknown>;
}
export const MAILBOX_TOOLS = {
  relay_message_send: schema("Queue an untrusted peer message; does not wake or authorize a worker.", { recipient: { type: "string", enum: ["agent_b", "agent_c"] }, idempotency_key: { type: "string", minLength: 1, maxLength: 80 }, text: { type: "string", minLength: 1, maxLength: 4096 } }, ["recipient", "idempotency_key", "text"], false),
  relay_message_receive: schema("Read up to ten pending messages addressed to your authenticated principal. Does not consume them.", {}, [], true),
  relay_message_reply: schema("Record one correlated reply to an incoming message. Does not execute its contents.", { message_id: { type: "string" }, text: { type: "string", minLength: 1, maxLength: 4096 } }, ["message_id", "text"], false),
  relay_message_get: schema("Read your sent or received message and its reply by identifier.", { message_id: { type: "string" } }, ["message_id"], true),
};
function schema(description: string, properties: Record<string, unknown>, required: string[], readOnlyHint: boolean) {
  return { description, inputSchema: { type: "object", properties, required, additionalProperties: false }, annotations: { readOnlyHint, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
}
export function mailboxEnabled(flag: unknown, role: string, mainOfficeFlag?: unknown): role is Peer {
  return (flag === "true" && (role === "agent_b" || role === "agent_c")) ||
    (mainOfficeFlag === "true" && (role === "codex" || role === "claude_desktop"));
}
export function mailboxTools(actor: Peer) {
  return Object.entries(MAILBOX_TOOLS).map(([name, spec]) => ({ name, ...spec,
    ...(name === "relay_message_send" ? { inputSchema: { ...spec.inputSchema,
      properties: { ...spec.inputSchema.properties, recipient: { type: "string", enum: [counterparts[actor]] } } } } : {}) }));
}
function fail(message: string): never { throw new Error(message); }
function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && new TextEncoder().encode(value).length <= 4096;
}
// Caller must wrap the entire operation in a storage transaction, including reads.
export async function mailboxCall(storage: MailboxStorage, actor: string, tool: string, input: unknown, now = Date.now()) {
  if (actor !== "agent_b" && actor !== "agent_c" && actor !== "codex" && actor !== "claude_desktop") fail("PRINCIPAL_NOT_ALLOWED");
  if (!Object.hasOwn(MAILBOX_TOOLS, tool)) fail("UNKNOWN_TOOL");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_ARGUMENTS");
  const args = input as Record<string, unknown>;
  const spec = MAILBOX_TOOLS[tool as keyof typeof MAILBOX_TOOLS].inputSchema;
  if (Object.keys(args).some(k => !Object.hasOwn(spec.properties, k)) || spec.required.some(k => !(k in args))) fail("INVALID_ARGUMENTS");
  const messages = (await storage.get<Message[]>("peer-messages") ?? []).filter(m => m.expires_at > now);
  const envelope = (value: unknown) => ({ label: "UNTRUSTED_PEER_DATA", delivery: "PULL_ONLY", execution_authorized: false, value });
  if (tool === "relay_message_send") {
    if (args.recipient !== counterparts[actor as Peer]) fail("INVALID_RECIPIENT");
    if (typeof args.idempotency_key !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(args.idempotency_key) || !boundedText(args.text)) fail("INVALID_ARGUMENTS");
    const prior = messages.find(m => m.sender === actor && m.key === args.idempotency_key);
    if (prior) {
      if (prior.recipient !== args.recipient || prior.text !== args.text) fail("IDEMPOTENCY_CONFLICT");
      return envelope(prior);
    }
    if (messages.length >= 100) fail("MAILBOX_FULL");
    const message: Message = { id: crypto.randomUUID(), sender: actor, recipient: counterparts[actor], key: args.idempotency_key, text: args.text, created_at: now, expires_at: now + 900_000 };
    messages.push(message);
    await storage.put("peer-messages", messages);
    return envelope(message);
  }
  if (tool === "relay_message_receive") return envelope(messages.filter(m => m.recipient === actor && m.reply === undefined).slice(0, 10));
  if (typeof args.message_id !== "string" || !/^[a-f0-9-]{36}$/.test(args.message_id)) fail("INVALID_ARGUMENTS");
  const message = messages.find(m => m.id === args.message_id && (m.sender === actor || m.recipient === actor));
  if (!message) fail("MESSAGE_NOT_FOUND_OR_EXPIRED");
  if (tool === "relay_message_reply") {
    if (message.recipient !== actor) fail("RECIPIENT_ONLY");
    if (!boundedText(args.text)) fail("INVALID_ARGUMENTS");
    if (message.reply !== undefined && message.reply !== args.text) fail("REPLY_CONFLICT");
    message.reply = args.text;
    await storage.put("peer-messages", messages);
  }
  return envelope(message);
}
