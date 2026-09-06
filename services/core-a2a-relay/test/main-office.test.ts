import test from "node:test";
import assert from "node:assert/strict";
import { mailboxCall, mailboxEnabled, mailboxTools } from "../src/mailbox.ts";
import { inboxIdentity } from "../src/inbox-identity.ts";

class Storage {
  data = new Map<string, unknown>();
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.data.set(key, structuredClone(value)); }
}
test("an idempotency key is reusable after the original message expires", async () => {
  const s = new Storage();
  const args={recipient:"claude_desktop",idempotency_key:"ttl-retry",text:"Hi Claude"};
  const first=await mailboxCall(s,"codex","relay_message_send",args,0);
  assert.deepEqual(await mailboxCall(s,"codex","relay_message_send",args,899999),first);
  const second=await mailboxCall(s,"codex","relay_message_send",args,900000);
  assert.notEqual((second.value as {id:string}).id,(first.value as {id:string}).id);
  assert.equal((await s.get<unknown[]>("peer-messages"))?.length,1);
});
test("Codex hi -> Claude inbox -> reply -> Codex read; reads do not consume", async () => {
  const s = new Storage();
  const args = { recipient: "claude_desktop", idempotency_key: "hello-1", text: "Hi Claude" };
  const sent = await mailboxCall(s, "codex", "relay_message_send", args, 0);
  const id = (sent.value as {id: string}).id;
  assert.equal(sent.execution_authorized, false);
  assert.equal(sent.delivery, "PULL_ONLY");
  const received = await mailboxCall(s, "claude_desktop", "relay_message_receive", {}, 1);
  assert.deepEqual(received, await mailboxCall(s, "claude_desktop", "relay_message_receive", {}, 2));
  assert.equal((received.value as {text: string}[])[0].text, "Hi Claude");
  await mailboxCall(s, "claude_desktop", "relay_message_reply", {message_id:id, text:"Hi Codex"}, 3);
  const reply = await mailboxCall(s, "codex", "relay_message_get", {message_id:id}, 4);
  assert.equal((reply.value as {reply:string}).reply, "Hi Codex");
  assert.deepEqual(await mailboxCall(s, "codex", "relay_message_send", args, 5), reply);
});
test("office participants cannot cross into B/C, impersonate senders, or read their messages", async () => {
  const s = new Storage();
  const sent = await mailboxCall(s, "agent_b", "relay_message_send", {recipient:"agent_c", idempotency_key:"x", text:"private"}, 0);
  const id = (sent.value as {id:string}).id;
  for (const actor of ["codex", "claude_desktop"]) {
    await assert.rejects(mailboxCall(s, actor, "relay_message_get", {message_id:id}, 1), /MESSAGE_NOT_FOUND/);
    await assert.rejects(mailboxCall(s, actor, "relay_message_send", {recipient:"agent_c", idempotency_key:"x", text:"x"}, 1), /INVALID_RECIPIENT/);
    await assert.rejects(mailboxCall(s, actor, "relay_message_receive", {sender:"agent_c"}, 1), /INVALID_ARGUMENTS/);
  }
});
test("office feature flag is separate and defaults closed", () => {
  assert.equal(mailboxEnabled("true", "codex"), false);
  assert.equal(mailboxEnabled(undefined, "codex", "true"), true);
  assert.equal(mailboxEnabled(undefined, "claude_desktop", "true"), true);
  assert.equal(mailboxEnabled(undefined, "agent_b", "true"), false);
  assert.equal(mailboxEnabled("true", "cursor", "true"), false);
  assert.equal(mailboxEnabled(undefined, "codex", true), false);
  const send = mailboxTools("codex").find(t => t.name === "relay_message_send")!;
  assert.deepEqual(send.inputSchema.properties.recipient, {type:"string", enum:["claude_desktop"]});
});
test("OAuth inbox mapping requires two exact distinct owner-configured client IDs", () => {
  assert.equal(inboxIdentity("c1", "c1", "c2"), "codex");
  assert.equal(inboxIdentity("c2", "c1", "c2"), "claude_desktop");
  for (const id of ["Claude", "codex", "C1", {}, undefined]) assert.equal(inboxIdentity(id, "c1", "c2"), null);
  assert.equal(inboxIdentity("c1", "c1", "c1"), null);
  assert.equal(inboxIdentity("c1", "c1"), null);
});
