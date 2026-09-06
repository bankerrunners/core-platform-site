# Snapshot — not the canonical relay

Owner decision, 2026-09-06 (recorded as D-022 in `CORE_PLATFORM_RECORD.md`):
the CORE A2A relay's canonical home is
`https://github.com/AgenCi-MAIN/masterswitch`, path `services/core-a2a-relay`,
branch `main`.

This directory is a labeled snapshot, not a second home. Its content is
`core-a2a-relay` `codex/worker-d-status-release@23a2d658` plus the integration
edits recorded in `b2cbd95` (2026-09-05): TypeScript import extensions in
`src/index.ts`, `npm test` wiring for the two `.mjs` suites, `README.md`, and
`docs/release-evidence/`. It does **not** include the Office messaging changes
(`office` role, `MCP_OFFICE_OAUTH_CLIENT_SHA256`, `office-mailbox.test.ts`)
that landed in masterswitch on 2026-09-06.

Do not edit here. Fix and release from masterswitch. The release evidence under
`docs/release-evidence/` was ported to masterswitch blob-identical and merged to
its `main` on 2026-09-06 as `194befa` (PR #2, owner-authorized after a privacy
review recorded in `CORE_PLATFORM_RECORD.md` D-022). It stays here as a dated
record of the 2026-09-05 integration.
