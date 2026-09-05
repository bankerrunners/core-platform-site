# Worker D status-only release candidate

September 5, 2026. HQ-only work; no other agent assigned or resumed.

## Verified this run

- Existing local connector was stopped. Verified saved worker/server paths and restarted its existing hidden launcher using the existing protected credential. No credential was read into chat or changed.
- Fresh authenticated Worker D status succeeded. Cursor desktop control remains disabled; this worker is a bounded tool runtime, not a coding agent.
- Nine new SQLite-backed adapter checks passed: email/SMS normalized intake, approval, correlated status response, review matching, duplicates/concurrency, restart, lost response, disk failure, invalid/privileged results, expired order, and serialized-adapter injection protection. These are fixture-based tests.
- Six existing dispatcher checks passed after repairing outdated import paths and execution-mode fixture fields. Existing approval-resume and authentication/route regressions passed.
- One attended diagnostic used a real Codex MCP Worker D call while the local durable adapter was waiting. The receipt matched and reached completed after HQ status review. `live-check-20260905/result.json` labels synthetic intake and explicitly records `hostedN8nExecuted:false`. No live email/SMS was received.
- Candidate TypeScript check and Cloudflare deployment dry run passed. No new Durable Object class or migration. Existing OAuth, inbox, and relay code is preserved from the renewal checkout; candidate-only route glue is added to its existing A2AJob class.
- Local workflow remains inactive with 54 nodes and unchanged executable connections. Two status notes updated locally and in the existing n8n editor; saved readback must be checked separately.

## Budget behavior

The status path uses no model calls. It admits diagnostic orders only and invokes only `worker_d_pilot_status` with empty arguments. One durable receipt per task blocks duplicate calls. Uncertain outcomes remain held across restarts; no automatic rerun. Calls are bounded to 20 seconds. The existing connector is the only restarted background process; no new model monitor or recurring task was created.

## Exact production changes still required

Target: existing `core-a2a-relay` on `https://core-a2a-relay.thrive18.workers.dev`; source: `release-candidate/`. Reconcile its `BASELINE.json` with the latest hosted version before upload, preserving all current OAuth/client bindings. `HOSTED_DEPLOYMENT_BASELINE.json` records the fresh hosted observation.

1. Configure server-only `INTAKE_CANDIDATE_CONFIG` with the verified existing email/SMS identity, resources and signing keys; distinct consumer and notify bearer credentials; notify URL for this n8n workflow. These values are not present in the package.
2. Configure a separate server-only `DISPATCHER_TOKEN`. Incoming email/SMS content cannot create approvals. Only a trusted Dispatcher client holding this credential may approve a bounded diagnostic or record its reviewed result.
3. Enable `WORKER_D_STATUS_ENABLED=true` only for the reviewed status-only pilot. Adapter creation is server-owned through the existing `MCP_PIPE` binding, never through request JSON. No new Worker D OAuth scope or desktop access is required.
4. Bind n8n `CORE_INTAKE_ADAPTER_BASE` to `https://core-a2a-relay.thrive18.workers.dev/candidate-intake`. Bind the consumer header credential on the five HTTP nodes and the separate notification header credential on the webhook.
5. Candidate ingress paths are `/candidate-intake/intake/email` and `/candidate-intake/intake/sms`. Consumer paths are `/candidate-intake/consumer/{lookup,accept,claim,route,result}`. Dispatcher paths are `/dispatcher/approval`, `/dispatcher/query/<receiptRef>`, and `/dispatcher/result`.
6. Verify invalid auth produces no mutation; provider signature, resource and replay checks; one real email and one real SMS receipt; approval; one Worker D status call; separate reviewed completion; duplicate intake; disconnect/unknown-result hold; n8n execution and truthful final response. Publish only for this pilot after bindings and tests pass. Broader worker coding/wakeup remains outside this status-only capability.

The current hosted secret-name inventory contains neither `INTAKE_CANDIDATE_CONFIG` nor `DISPATCHER_TOKEN`. Creating/binding these and deploying are the remaining consequential release actions, not a request to toggle the already-working connector again.

## Verification commands

From `integration/`:

```powershell
node --test worker-d-status-tests.mjs
node approval-resume-tests.mjs
node hq-regressions.mjs
node dispatcher-tests.mjs
```

From `release-candidate/`, use its existing dependency runtime for `tsc --noEmit` and `wrangler deploy --dry-run`. The local dependency junction is excluded from the release ZIP.

## Limits

No deployment, new credential, production binding, provider subscription, or n8n activation occurred. Reviewer identity currently depends on the separate trusted Dispatcher credential and the ledger's contributor checks; this is not an independently authenticated reviewer service. The status worker does not build software or control Cursor. Other fleet entries remain dated registry evidence.
