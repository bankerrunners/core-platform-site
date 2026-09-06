import test from "node:test";
import assert from "node:assert/strict";
import { mailboxCall, mailboxEnabled } from "../src/mailbox.ts";
class Storage {
  data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.data.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.data.set(key, structuredClone(value)); }
}
const send = (s: Storage, key = "test-1", now = 0) => mailboxCall(s, "agent_b", "relay_message_send", { recipient: "agent_c", idempotency_key: key, text: "diagnostic ping" }, now);
test("B -> C -> B correlated round trip preserves data and grants no execution authority", async () => {
  const s = new Storage();
  const sent = await send(s);
  const id = (sent.value as { id: string }).id;
  assert.equal(sent.execution_authorized, false);
  assert.equal(sent.delivery, "PULL_ONLY");
  const incoming = await mailboxCall(s, "agent_c", "relay_message_receive", {}, 1);
  assert.equal((incoming.value as { id: string }[])[0].id, id);
  await mailboxCall(s, "agent_c", "relay_message_reply", { message_id: id, text: "diagnostic pong" }, 2);
  const read = await mailboxCall(s, "agent_b", "relay_message_get", { message_id: id }, 3);
  assert.equal((read.value as { reply: string }).reply, "diagnostic pong");
  assert.deepEqual((await mailboxCall(s, "agent_c", "relay_message_receive", {}, 4)).value, []);
});
test("duplicate send and reply are idempotent; conflicting retries cannot overwrite", async () => {
  const s = new Storage();
  const first = await send(s);
  assert.deepEqual(await send(s), first);
  await assert.rejects(mailboxCall(s, "agent_b", "relay_message_send", { recipient: "agent_c", idempotency_key: "test-1", text: "changed" }, 1), /IDEMPOTENCY_CONFLICT/);
  const args = { message_id: (first.value as {id:string}).id, text: "pong" };
  assert.deepEqual(await mailboxCall(s, "agent_c", "relay_message_reply", args, 1), await mailboxCall(s, "agent_c", "relay_message_reply", args, 2));
  await assert.rejects(mailboxCall(s, "agent_c", "relay_message_reply", {...args, text:"changed"}, 3), /REPLY_CONFLICT/);
});
test("principal isolation and strict arguments reject impersonation and sender replies", async () => {
  const s = new Storage();
  const id = ((await send(s)).value as {id:string}).id;
  await assert.rejects(mailboxCall(s, "cursor", "relay_message_get", { message_id:id }, 1), /PRINCIPAL_NOT_ALLOWED/);
  await assert.rejects(mailboxCall(s, "agent_b", "relay_message_reply", { message_id:id, text:"fake" }, 1), /RECIPIENT_ONLY/);
  await assert.rejects(mailboxCall(s, "agent_b", "relay_message_receive", { actor:"agent_c" }, 1), /INVALID_ARGUMENTS/);
  assert.deepEqual((await mailboxCall(s, "agent_b", "relay_message_receive", {}, 1)).value, []);
  await assert.rejects(mailboxCall(s, "agent_b", "relay_message_send", { recipient:"agent_b", idempotency_key:"x", text:"x" }, 1), /INVALID_RECIPIENT/);
});
test("expiry and bounded capacity prevent unbounded backlog", async () => {
  const s = new Storage();
  for (let i=0; i<100; i++) await send(s, String(i));
  await assert.rejects(send(s, "overflow"), /MAILBOX_FULL/);
  const firstId = ((await send(s, "0")).value as {id:string}).id;
  await assert.rejects(mailboxCall(s, "agent_b", "relay_message_get", {message_id:firstId}, 900000), /EXPIRED/);
  await send(s, "after-expiry", 900000);
  assert.equal((await s.get<unknown[]>("peer-messages"))?.length, 1);
});
test("disabled by default and only dedicated B/C principals can use messaging", () => {
  for (const flag of [undefined, "false", "TRUE", true]) assert.equal(mailboxEnabled(flag, "agent_b"), false);
  for (const actor of ["cursor", "bionic", "worker_zero", "__proto__"]) assert.equal(mailboxEnabled("true", actor), false);
  assert.equal(mailboxEnabled("true", "agent_b"), true);
  assert.equal(mailboxEnabled("true", "agent_c"), true);
});
test("malformed and oversized content never enters storage", async () => {
  const s = new Storage();
  for (const text of ["", "   ", "é".repeat(2049), 12]) await assert.rejects(mailboxCall(s, "agent_b", "relay_message_send", {recipient:"agent_c", idempotency_key:"x", text}, 0), /INVALID_ARGUMENTS/);
  await assert.rejects(mailboxCall(s, "agent_b", "constructor", {}, 0), /UNKNOWN_TOOL/);
  assert.equal(s.data.size, 0);
});
