import test from "node:test";
import assert from "node:assert/strict";
import worker, { A2AJob, type Env } from "../src/index.ts";
import { signOAuthPayload } from "../src/oauth.ts";

const origin = "https://relay.example";
test("alarm removes expired messages, schedules the next expiry, and deletes an empty inbox", async () => {
  const now = Date.now();
  const data = new Map<string, unknown>([["peer-messages", [{id:"old",expires_at:now-1},{id:"live",expires_at:now+900000}]]]);
  let nextAlarm: number | undefined;
  const tx = {get:async(k:string)=>structuredClone(data.get(k)),put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));},delete:async(k:string)=>data.delete(k),setAlarm:async(n:number)=>{nextAlarm=n;},deleteAlarm:async()=>{nextAlarm=undefined;}};
  const job = new A2AJob({storage:{get:tx.get,transaction:async(fn:Function)=>fn(tx)}} as never, {} as Env);
  await job.alarm();
  assert.deepEqual(data.get("peer-messages"),[{id:"live",expires_at:now+900000}]);
  assert.equal(nextAlarm,now+900000);
  data.set("peer-messages",[{id:"old",expires_at:now-1}]); nextAlarm=undefined;
  await job.alarm();
  assert.equal(data.has("peer-messages"),false);
  assert.equal(nextAlarm,undefined);
});
async function fixture(enabled = "true") {
  const fingerprint = async (v:string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,"0")).join("");
  const stores = new Map<string, Map<string, unknown>>();
  let forwards = 0;
  const env = { OAUTH_SIGNING_SECRET: "local-test-only-signing-secret-123456", MCP_MAX_REQUEST_BYTES: "1048576",
    MCP_MAIN_OFFICE_MESSAGES_ENABLED: enabled, MCP_CODEX_OAUTH_CLIENT_SHA256: await fingerprint("codex-test"), MCP_CLAUDE_DESKTOP_OAUTH_CLIENT_SHA256: await fingerprint("claude-test"),
    MCP_PIPE: {idFromName: (n:string)=>n, get:()=>({fetch:()=>{forwards++; throw Error("Must not invoke Worker D");}})},
    A2A_JOB: {idFromName:(n:string)=>n, get:(id:string)=>{
      if (!stores.has(id)) stores.set(id, new Map());
      const data = stores.get(id)!;
      const tx = {get:async(k:string)=>structuredClone(data.get(k)), put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}, getAlarm:async()=>null, setAlarm:async()=>{}};
      return new A2AJob({storage:{transaction:async(fn:Function)=>fn(tx)}} as never, env);
    }} } as unknown as Env;
  async function rpc(client:string, method:string, params?:unknown, overrides = {}) {
    const token = await signOAuthPayload({kind:"oauth_access", iss:origin, role:"cursor", scope:"mcp:tools", aud:origin+"/mcp", client_id:client, exp:Math.floor(Date.now()/1000)+60, ...overrides}, env.OAUTH_SIGNING_SECRET);
    const response = await worker.fetch(new Request(origin+"/mcp", {method:"POST", headers:{authorization:`Bearer ${token}`}, body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})}), env);
    return {status:response.status, body:await response.json() as any};
  }
  return {rpc, stores, forwarded:()=>forwards};
}
test("authenticated MCP gateway completes the office round trip without the local connector", async () => {
  const f = await fixture();
  const list = await f.rpc("codex-test", "tools/list");
  assert.equal(list.body.result.tools.length, 11);
  const identity = await f.rpc("codex-test", "tools/call", {name:"relay_inbox_status",arguments:{}});
  const status = JSON.parse(identity.body.result.content[0].text);
  assert.equal(status.principal,"codex");
  assert.match(status.client_fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(status.enabled,true);
  const sent = await f.rpc("codex-test", "tools/call", {name:"relay_message_send", arguments:{recipient:"claude_desktop",idempotency_key:"first-hi",text:"Hi Claude"}});
  const id = JSON.parse(sent.body.result.content[0].text).value.id;
  const inbox = await f.rpc("claude-test", "tools/call", {name:"relay_message_receive",arguments:{}});
  assert.equal(JSON.parse(inbox.body.result.content[0].text).value[0].id,id);
  await f.rpc("claude-test", "tools/call", {name:"relay_message_reply",arguments:{message_id:id,text:"Hi Codex"}});
  const result = await f.rpc("codex-test", "tools/call", {name:"relay_message_get",arguments:{message_id:id}});
  assert.equal(JSON.parse(result.body.result.content[0].text).value.reply,"Hi Codex");
  assert.deepEqual([...f.stores.keys()], ["main-office-mailbox-v1"]);
  assert.equal(f.forwarded(),0);
});
test("disabled or unmapped clients cannot list or call mailbox tools", async () => {
  for (const [flag, client] of [["false","codex-test"],["true","unknown-client"]]) {
    const f=await fixture(flag);
    assert.equal((await f.rpc(client,"tools/list")).body.result.tools.length,7);
    assert.equal((await f.rpc(client,"tools/call",{name:"relay_message_receive",arguments:{}})).status,403);
    assert.equal(f.stores.size,0);
  }
});
test("invalid signed-token claims fail before mailbox identity selection", async () => {
  for (const overrides of [{aud:"https://other/mcp"},{iss:"https://other"},{scope:"other"},{exp:0}]) {
    const f=await fixture();
    assert.equal((await f.rpc("codex-test","tools/list",undefined,overrides)).status,401);
    assert.equal(f.stores.size,0);
  }
});
