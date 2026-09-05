import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("connector permits every tool advertised by the relay", async () => {
  const source = await readFile(new URL("../connector/index.mjs", import.meta.url), "utf8");
  const advertisedTools = [
    "worker_d_pilot_status",
    "worker_d_evidence_hash_calculate",
    "worker_d_artifact_inventory",
    "worker_d_evidence_compare",
    "worker_d_allowed_app_status",
    "worker_d_sandbox_text_write",
  ];

  for (const tool of advertisedTools) {
    assert.match(source, new RegExp(`\\b${tool}\\b`), `${tool} must be permitted by the connector`);
  }
});
