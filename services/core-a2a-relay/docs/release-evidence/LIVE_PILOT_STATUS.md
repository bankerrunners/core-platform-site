# Live intake and Worker D pilot

Verified September 5, 2026. This is a bounded status pilot, not a general coding-worker dispatcher.

## Verified

- Existing Dasher email and SMS subscriptions deliver to the signed relay intake routes. Real provider deliveries returned 202 with matching durable references.
- The existing n8n workflow is published. CORE Intake Notify protects its incoming reference webhook; CORE Intake Consumer is bound to all five relay HTTP steps. Missing notification credentials return 403.
- Real email and SMS references passed the production n8n sequence. Pre-publication notification failures were recovered explicitly using their existing references, without creating duplicate tasks.
- One explicitly approved real SMS receipt invoked Worker D's fixed read-only status tool. HQ checked its observation, receipt, and correlation; recorded a non-contributor review; and independently read back completed state.
- After the notification runtime repair, synthetic signed email and SMS fixtures reached n8n automatically and acquired durable acceptance records. These fixtures were not real provider messages. Neither fixture was approved for worker execution.
- The canvas notes now distinguish the live bounded pilot from inactive registry entries.

## Runtime repair

The production alarm could not send notifications because this Workers runtime rejects `redirect: 'error'` before network I/O. Reproduced in workerd with the deployed compatibility date; notification tests observed zero outbound requests before the fix.

Changed only the notification fetch to `redirect: 'manual'`. Existing status handling rejects redirects; credentials are not forwarded to a different destination. Three runtime regression tests and nine Worker D tests passed, as did TypeScript and deployment dry-run. Deployed version: `6ef3b8e7-426f-4a22-9e27-7bd93d560cab`.

Base source commit: `f42d18a367a79aa0e040a9ee037b82a05f8eab3a`. This release snapshot includes the one-line repair, new runtime tests, and verification records. Push is pending confirmation of the remote repository. No other branches or worktrees were changed.

## Operation and limits

New inbound messages enter held state until explicitly approved. Incoming text is data, never an authorization instruction. The permitted live adapter invokes only Worker D status; it cannot code, control the desktop, deploy, or launch other workers. No model calls were used in this pilot execution.

Notification recovery is bounded; the second diagnostic fixture was accepted on a later alarm cycle, approximately 35 seconds after intake. Unknown outcomes remain held for receipt inspection, not blind replay. Previously held messages do not automatically become approved when the transport is repaired.

The reviewer is separated from the worker by application validation. Both review and approval use the Dispatcher credential; cryptographically separate reviewer credentials are not implemented.

## Evidence

- `HOSTED_RELEASE_RECEIPT.json`: release, configuration, real provider references, Worker D completion, and known recovery.
- `AUTOMATIC_NOTIFICATION_VERIFICATION.json`: separately labeled synthetic inputs and actual production n8n acceptance evidence.
- Release checkout: `C:\Users\k2547\OneDrive\Documents\ChatGPT\Master-control-worker-d-release\cloudflare-a2a-relay`.
- Runtime regression: `notification-runtime-tests.mjs`; existing bounded-worker checks: `worker-d-status-tests.mjs`.
- Workflow: https://bankerrunners.app.n8n.cloud/workflow/NyZpdwTTbBKupTBl

No credentials, signing keys, or private message bodies are included in these records.
