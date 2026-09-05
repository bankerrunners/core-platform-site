import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TOOLS = new Set(["worker_d_pilot_status", "worker_d_evidence_hash_calculate", "worker_d_artifact_inventory", "worker_d_evidence_compare", "worker_d_allowed_app_status", "worker_d_sandbox_text_write"]);
const gateway = required("WORKER_D_GATEWAY_URL").replace(/^http/, "ws").replace(/\/$/, "") + "/v1/connector";
const server = required("WORKER_D_SERVER_PATH");
const root = required("WORKER_D_EVIDENCE_ROOT");
const tokenFile = required("WORKER_D_CONNECTOR_TOKEN_FILE");
const logDir = process.env.WORKER_D_CONNECTOR_LOG_DIR || join(process.env.LOCALAPPDATA || ".", "CoreWorkerD", "logs");
let rpc;
let active = null;
let stopped = false;
let reconnectAttempt = 0;

class StdioRpc {
  constructor() { this.client = null; this.transport = null; this.child = null; }
  async start() {
    this.transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, WORKER_D_EVIDENCE_ROOT: root, WORKER_D_APPROVED_EVIDENCE_ROOT: root }, stderr: "pipe" });
    this.client = new Client({ name: "core-worker-d-connector", version: "0.2.0" });
    await this.client.connect(this.transport);
    this.child = { get exitCode() { return thisTransport.pid ? null : 1; } };
    const thisTransport = this.transport;
  }
  request(method, params) { if (!this.client || method !== "tools/call") return Promise.reject(new Error("Worker D unavailable")); return this.client.callTool({ name: params.name, arguments: params.arguments }); }
  close() { void this.client?.close(); this.client = null; this.transport = null; this.child = null; }
}

async function ensureRpc() {
  if (rpc && rpc.child?.exitCode == null) return rpc;
  for (let attempt = 0; attempt < 5; attempt++) { try { rpc = new StdioRpc(); await rpc.start(); return rpc; } catch (error) { await log("worker_restart", "HELD", error); await sleep(Math.min(1000 * 2 ** attempt, 15000)); } }
  throw new Error("Worker D could not start");
}

async function invoke(ws, msg) {
  const started = Date.now(); const id = typeof msg.request_id === "string" ? msg.request_id : "invalid"; const tool = msg.tool;
  if (active) return send(ws, { version: 1, type: "result", request_id: id, error: "Worker D is busy" });
  if (msg.version !== 1 || !TOOLS.has(tool) || !msg.arguments || typeof msg.arguments !== "object" || typeof msg.deadline !== "number") return send(ws, { version: 1, type: "result", request_id: id, error: "Invalid invocation" });
  if (msg.deadline <= Date.now()) return send(ws, { version: 1, type: "result", request_id: id, error: "Invocation expired" });
  active = id;
  try { const client = await ensureRpc(); const result = await client.request("tools/call", { name: tool, arguments: msg.arguments }); if (active === id && Date.now() <= msg.deadline) send(ws, { version: 1, type: "result", request_id: id, result }); await log(tool, "COMPLETED", null, Date.now() - started); }
  catch (error) { if (active === id) send(ws, { version: 1, type: "result", request_id: id, error: safeError(error) }); await log(tool, "HELD", error, Date.now() - started); rpc?.close(); rpc = null; }
  finally { if (active === id) active = null; }
}

async function connect() {
  const token = (await readSecret()).trim();
  const ws = new WebSocket(gateway, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 15000 });
  ws.on("open", async () => { reconnectAttempt = 0; send(ws, { version: 1, type: "status", degraded: false }); await log("connector", "ONLINE"); });
  ws.on("message", (data) => { try { const msg = JSON.parse(String(data)); if (msg.type === "invoke") void invoke(ws, msg); else if (msg.type === "cancel" && msg.request_id === active) active = null; } catch {} });
  ws.on("close", () => retry()); ws.on("error", () => ws.close());
}
async function retry() { if (stopped) return; const wait = Math.min(1000 * 2 ** reconnectAttempt++, 30000) + Math.floor(Math.random() * 500); await sleep(wait); void connect().catch(async (e) => { await log("connector", "HELD", e); retry(); }); }
async function readSecret() { if (process.platform !== "win32") return readFile(tokenFile, "utf8"); return new Promise((resolve, reject) => { const escaped = tokenFile.replaceAll("'", "''"); const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$s=Import-Clixml -LiteralPath '${escaped}'; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }); let out=""; p.stdout.on("data", d => out += d); p.on("exit", c => c === 0 ? resolve(out) : reject(new Error("Credential file could not be read"))); }); }
function send(ws, value) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function safeError(error) { const text = error instanceof Error ? error.message : "Worker D invocation failed"; return text.replace(/[A-Za-z]:\\[^\s]+/g, "[local-path]").slice(0, 300); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function log(action, outcome, error = null, duration_ms = undefined) { await mkdir(logDir, { recursive: true }); const file = join(logDir, "connector.jsonl"); try { if ((await stat(file)).size > 5 * 1024 * 1024) await rename(file, join(logDir, "connector.previous.jsonl")); } catch {} const entry = { at: new Date().toISOString(), action, outcome, ...(duration_ms === undefined ? {} : { duration_ms }), ...(error ? { reason: safeError(error) } : {}) }; await appendFile(file, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 }); }
process.on("SIGINT", () => { stopped = true; rpc?.close(); process.exit(0); });
void connect().catch(async (e) => { await log("connector", "HELD", e); retry(); });
