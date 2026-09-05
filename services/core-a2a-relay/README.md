# CORE A2A relay

Independent Cloudflare service for authenticated CORE MCP access, signed Inkbox email/SMS intake, durable n8n handoff, and the approved Worker D status-only pilot. It is not part of the portal application build.

Imported from verified local release `23a2d658fe70e9d49e781712b901ded9162402dc`. The deployed notification repair is Worker version `6ef3b8e7-426f-4a22-9e27-7bd93d560cab`.

## Validate

Run from this directory with Node 24:

```sh
npm ci
npm run typecheck
npm test
```

Use this package's own dependency lockfile and TypeScript configuration. The repository root already excludes independent `services` from portal typechecking. All 43 package tests and the package typecheck passed in the integration checkout. Two bridge imports now include their TypeScript extensions, and the mailbox alarm test double implements the storage methods the runtime uses. These integration-only corrections do not change deployed behavior.

## Configuration

Credentials stay in the hosting secret store. Never commit their values. Required pilot settings are `INTAKE_CANDIDATE_CONFIG`, `DISPATCHER_TOKEN`, and `WORKER_D_STATUS_ENABLED`. The intake configuration contains the channel identity/resource/signing key and separate consumer/notification credentials. The published n8n workflow uses Header Auth credentials, not embedded values.

The provider routes accept signed, text-only email and SMS events. New tasks stay held until explicitly approved. The live adapter invokes only `worker_d_pilot_status`; it does not run general coding jobs, shell commands, or desktop automation. Unknown outcomes require inspection and remain held instead of being replayed blindly.

## Verification records

`docs/release-evidence/LIVE_PILOT_STATUS.md` describes real provider receipts, production n8n acceptance, reviewed Worker D completion, and separate synthetic tests of automatic notification. Earlier baseline and manifest files are dated evidence, not claims about the current version. Local filesystem references in those historical records refer to the original release checkout.

This repository import does not deploy the portal, change credentials, approve additional worker tasks, or alter other agents' roles.

Integration lint was run with the repository's ESLint configuration. It reports 13 inherited test-fixture typing errors (`no-explicit-any` and `no-unsafe-function-type`) and 8 warnings; lint is not claimed passing. Runtime tests (43/43) and service TypeScript checks pass. Portal source is unchanged.
