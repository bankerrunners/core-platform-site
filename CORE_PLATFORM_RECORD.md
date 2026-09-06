# CORE / THRIVE platform — operating record

The single reference for what exists, where it lives, and how to operate it.
Written 2026-08-14, the day the portal was first self-hosted and signed into.

**No secret values appear in this file, and none ever should.** Secret *names*
are listed so you know what must exist; the values live only in Cloudflare's
secret store, Google Cloud console, and whatever password manager the owner
keeps. If a value ever lands in this file, rotate it rather than deleting it.

---

## 1. What this is

A permissioned operating portal for THRIVE, deployed as a single Cloudflare
Worker. The app serves a public site and a closed `/portal` — and Cloudflare
Access fronts the domain: anonymous requests are refused at the edge before
this application runs (first stood up 2026-08-16 on the old account, §16;
rebuilt 2026-08-18 on the new account as Zero Trust team `thrive18`,
Google-only login, named-email allow policy — see DEPLOYMENT.md's
2026-08-18 entries).
Everything under `/portal` is closed
by default and opens only to people who hold a membership row, at the role that
row carries. Two independent checks run on every request:

1. **Identity** — Sign in with Google proves who the visitor is.
2. **Membership** — an active `portal_members` row proves they belong to CORE
   and fixes their role.

Identity alone grants nothing: anyone on earth can complete step 1. Step 2 is
what actually protects the portal, and it fails closed — if the database is
unreachable or unmigrated, access is refused rather than assumed.

Every allow and every deny is written to an append-only `audit_events` table.

---

## 2. Live infrastructure

| Thing | Value |
| --- | --- |
| Public URL | `https://site-creator-vinext-starter.thrive18.workers.dev` — **this is the one to give a member.** Corrected 2026-08-18: this row named the retired `bankerrunners` address for a day after the account migration, contradicting the `workers.dev subdomain` row directly below it. That contradiction was not theoretical — it was read off this table and mailed to all four founders as their setup link (see §10), pointing them at the frozen copy and its abandoned database. A stale row in a summary table is how a stale fact reaches a human. |
| Worker name | `site-creator-vinext-starter` |
| Cloudflare account | `Btcmao518@gmail.com's Account` — `f39f3a77e56b28e4dfae29489a997014` (GitHub SSO; MIGRATED 2026-08-18 from the old `Bankerrunners@gmail.com` account `e6f9d0a344a0a7b317601ffbe23f871e`, whose recovery email was lost — old account left running until cutover, then abandoned) |
| workers.dev subdomain | `thrive18` — live at `https://site-creator-vinext-starter.thrive18.workers.dev` since 2026-08-18, owner sign-in verified (was `bankerrunners` on the old account, whose worker still runs unadministered behind its Access gate — do not send members there) |
| D1 database | `site-creator-d1` — `e19d74e0-1913-41a5-b695-cd1acc94d5ed` (new account; old-account db was `e00c30f0-7017-49d8-9f81-446cef9e32c3`, exported to the owner's machine 2026-08-17/18 before migration) |
| R2 bucket | `site-creator-r2` (binding `CALL_RECORDINGS`) |
| GitHub repo | `AgenCi-MAIN/core-platform-site` — **transferred 2026-08-26** from `bankerrunners/core-platform-site`. The old path still resolves, by a GitHub 301 that survives only while GitHub chooses to keep it, so every live doc, portal link and runbook was moved to the new path on 2026-08-27 rather than left riding the redirect. Dated snapshots (`SESSION-BACKUP-2026-08-16.md`, `strategy/2026-08-17-claude-account-migration.md`, `strategy/2026-08-17-routines-export.md`) still name the old path **on purpose** — they record what was true on their date. **Do not blind-replace `bankerrunners` in this repo:** the same word is also the retired founder identity `bankerrunners@gmail.com` and the abandoned Cloudflare subdomain, and a global find-and-replace rewrites the account-migration history above into nonsense. |
| Working branch | `main` — PR #1 (`claude/new-session-9a8g4o`) merged long ago; work lands on `main` through squash-merged pull requests (the PR trail) |
| Local checkout | **`C:\dev\core-platform-site` — the working copy. Deploy from here.** Corrected 2026-08-17: this row previously named `C:\Users\k2547\OneDrive\Desktop\core-platform-site`, which is **not** the copy deploys run from and **must not be worked in**. A git repository inside OneDrive fights the sync client for file handles: on 2026-08-17 that produced three escalating `Deletion of directory ... failed. Should I try again?` prompts in a single operation — first a remote-tracking ref, then untracked build output, then **`app/auth/callback`, which is tracked source**, leaving a half-reset tree one command away from a deploy. Three frozen backup copies also exist under ARCHIVE, MAINBACK, and RE SUMMON — never work in those either. |

The D1 id lives in `.openai/hosting.json`; `vite.config.ts` reads it into the
D1 binding config it hands the Cloudflare Vite plugin, which emits
`dist/server/wrangler.json` at build time — the config `wrangler deploy`
actually reads. (`build/sites-vite-plugin.ts` does not carry the id: it copies
`hosting.json` and `drizzle/` into `dist/.openai/`. Corrected 2026-08-17
against the code.)

~~Stray resource to clean up~~ — the accidental empty D1 database named `8`
(`5bc64b69-1c83-4826-adf8-dcad4f576885`) was deleted by the owner on
2026-08-15. Exactly one D1 database exists: `site-creator-d1`.

---

## 3. Identity — Sign in with Google

Implemented in the app itself. (Since 2026-08-16 Cloudflare Access sits in
front of the domain, but the app trusts nothing from it — identity still comes
only from the app's own `core_session` cookie.)

| File | Responsibility |
| --- | --- |
| `app/google-auth.ts` | Session cookie (`core_session`), token mint/verify, cookie helpers, return-path validation |
| `app/auth/signin/route.ts` | Starts OAuth 2.0 authorization-code flow with PKCE |
| `app/auth/callback/route.ts` | Exchanges the code server-side, validates the ID token, mints the session |
| `app/auth/signout/route.ts` | Clears the session cookie |
| `app/portal/access.ts` | Membership, roles, capabilities, audit writes |

The session token is `v1.<base64url payload>.<base64url hmac>`, authenticated
with HMAC-SHA256 under `SESSION_SECRET`. A token that fails verification for any
reason — bad format, bad signature, expired, malformed payload — is treated as
no identity at all. Sessions last 7 days.

Only Google addresses with `email_verified: true` are accepted. An unverified
address can be claimed by anyone at the provider, and since the allowlist is
keyed by email, admitting one would let a stranger register a member's address
and inherit their access.

**The retired `oai-authenticated-user-*` headers are ignored entirely.** Under
the previous hosting platform those headers carried identity, trustworthy only
because the platform stripped them from incoming requests. Self-hosted there is
no such platform, so a header would be writable by anyone — sending the owner's
email in a request header would have been enough to take the portal over.
`tests/portal-authorization.test.mjs` pins this shut with two suites: one
proving the retired headers grant nothing, one proving a forged, tampered, or
expired cookie is anonymous.

### Google OAuth client

Type **Web application**, in the Google Cloud project on the owner's account.
Exactly one authorized redirect URI:

```
https://site-creator-vinext-starter.thrive18.workers.dev/auth/callback
```

**Corrected 2026-08-18.** This block printed the pre-migration `bankerrunners`
callback for a day after the account move. It is now known to be the `thrive18`
one, and that is not an assumption — it follows from the code:
`app/auth/signin/route.ts` and `app/auth/callback/route.ts` both build the
redirect as `` `${url.origin}/auth/callback` ``, derived from the **request's own
host** rather than a constant. So a request served at `thrive18` sends Google
the `thrive18` callback, and Google refuses any `redirect_uri` its client has
not registered (`redirect_uri_mismatch`). A portal sign-in that succeeds at
`thrive18` therefore proves the console already lists that callback. The owner
confirmed the successful sign-in was his, 2026-08-18.

Whether the retired `bankerrunners` callback is *also* still listed on the
client is unknown and harmless — it points at a worker nobody administers.
Pruning it is tidy, not urgent.

The `${url.origin}` derivation is also why the custom-domain follow-up in §10
matters: on a domain cutover the app starts sending a callback Google has never
seen, and sign-in breaks at that instant unless the new URI is registered
first. Nothing in the code will warn you.

Authorized JavaScript origins: none — the flow is entirely server-side.

The consent screen is **External** and unpublished, so first-time users see an
"unverified app" interstitial. That is expected for a private app; continue via
**Advanced → Go to THRIVE Portal**.

**RESOLVED 2026-08-17: the client lives in the `core-portal` Cloud project
under `btcmao518@gmail.com`** (project id `core-portal-505803`). Google locked
the original `bankerrunners@gmail.com` account on 2026-08-17, killing the old
client with it; a new client was minted under the new identity, the two
Google secrets rotated via `wrangler secret put`, and sign-in verified live
the same night (btcmao518 signed in, bound, and read the founder-only audit
log). Full incident + decision record:
`strategy/2026-08-17-identity-recovery-docket.md`. Still open from that
docket: the Cloudflare account email swap (blocked on a lost password —
support ticket path; a scoped API token hedge exists), and Google recovery of
the old account for GitHub/Drive.

### Secrets (names only)

| Secret | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client id, ends `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret, starts `GOCSPX-` |
| `SESSION_SECRET` | Long random string signing session cookies |
| `ANTHROPIC_API_KEY` | Powers the JARVIS Presence (member Q&A pet). Optional — absent means the Presence answers with an honest 503, nothing else breaks. Get one at console.anthropic.com, set with `npx wrangler secret put ANTHROPIC_API_KEY -c dist/server/wrangler.json`. |
| `SIGNALWIRE_INGEST_SECRET` | The credential the carrier presents to `/portal/calls/ingest` (§ 10e, OWNER-DECISIONS D10). Absent means the route refuses every POST — unconfigured is closed, not open. |
| `SIGNALWIRE_INGEST_SECRET_PREVIOUS` | The outgoing value during a rotation, accepted alongside the current one so the secret can change without a window where live calls are dropped. Delete it once the carrier is confirmed sending the new one. |
| `SIGNALWIRE_SIGNING_KEY` | Verifies the carrier's request signature on that same route. |
| `SIGNALWIRE_PUBLIC_ORIGIN` | The origin the signature was computed over. Not secret in the way the others are — it is a URL — but it is configured rather than read off the request, because a proxy can rewrite the host and a signature recomputed over the wrong URL fails for a legitimate caller. |
| `SIGNALWIRE_AGENT_MAP` | Carrier-side agent numbers → member email addresses. A Worker secret rather than a D1 table, so staff mobile numbers stay out of the database and out of its exports (OWNER-DECISIONS F2). |
| `SIGNALWIRE_DIALER_SPACE_URL` | The SignalWire Space host used only by the founder-controlled outbound route. It is configured rather than accepted from the browser. |
| `SIGNALWIRE_DIALER_PROJECT_ID` | The SignalWire Project intentionally shared by the CORE platform dialer. An identifier rather than a secret, but kept in hosted runtime configuration so a project move does not require a source edit. |
| `SIGNALWIRE_DIALER_TOKEN` | Dedicated outbound token. It must belong to the configured Project and have Voice permission only. Never reuse a browser-stored or broadly scoped token. |
| `SIGNALWIRE_DIALER_AGENT_NUMBER` | The private mobile CORE rings before any customer. It is a Worker secret and is never sent to the browser, written to D1, or copied into the audit trail. |

**The Presence's isolation contract (governance, 2026-08-15).** The
`pet.chat` capability was granted to every role: the Presence is the one
model-powered surface members can talk to, and it is safe because it is
architecturally inert — the model gets no tools, its output is rendered as
plain text, and the route holds no credential except the API key (which can
spend tokens and nothing else). A prompt injection through it yields words
in a chat bubble. Spend is bounded: ~700 tokens per answer, 40
answers/member/day (counted from the audit log), every exchange audited
with token usage. Adding a tool or a write path to that route is a
governance decision. Model: `claude-opus-5` by default; set the
`PRESENCE_MODEL` variable (a plain var, not a secret) to
`claude-haiku-4-5` for the budget option (~5× cheaper per answer) —
owner's call, undecided as of this writing.

List what is set (never prints values):

```powershell
npx wrangler secret list -c dist/server/wrangler.json
```

Rotating `SESSION_SECRET` signs everyone out and breaks nothing else. Nobody
ever needs to know its value.

---

## 4. Roles and capabilities

Deny by default: a role holds exactly what is listed and nothing more.
Capabilities are enforced server-side, not merely hidden in the interface.

| Capability | owner | admin | manager | reviewer | agent | support |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `portal.access` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `dashboard.view.self` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `book.view.self` | ✅ | ✅ | ✅ | — | ✅ | — |
| `calls.review` | ✅ | ✅ | ✅ | ✅ | — | — |
| `scripts.manage` | ✅ | ✅ | — | ✅ | — | — |
| `team.view` | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `leadership.view.all` | ✅ | ✅ | ✅ | — | — | — |
| `members.view` | ✅ | ✅ | ✅ | — | — | — |
| `members.manage` | ✅ | ✅ | — | — | — | — |
| `pet.chat` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

`audit.view` is granted to **no role**: the audit log and the INVESTIGATOR
console are founder-only, gated by identity (`requireFounder`), not by
capability — see the governance note in § 5. The name survives only as the
audit-row action for those pages' own allow/deny records.

Guard a page with `requireCapability(...)`; guard a write with
`assertCapability(...)`. Never import `app/portal/access.ts` from a
`"use client"` file. Adding a capability to a role is a governance decision.

---

## 5. Members

| Email | Name | Role | Granted |
| --- | --- | --- | --- |
| `btcmao518@gmail.com` | Yuxiang Mao (Shawn) — **current founder identity** | owner | owner-migration 2026-08-17 (`db/sql/0003`); signed in and bound 2026-08-17 |
| `bankerrunners@gmail.com` | Yuxiang Mao (Shawn) — retired identity (Google locked the account 2026-08-17; cannot sign in; row retained for the record; **outreach PAUSED through 2026-08-20 — do not email this address; after that, owner's word required, A12**) | owner | bootstrap, 2026-08-14 |
| `ryandavidson.zenith@gmail.com` | Ryan Davidson | **reviewer** | seated as owner by Shawn 2026-08-14; **demoted `owner` → `reviewer` and revoked 2026-08-26 (A30)**. Holds no access. |
| `epiclife.nguyen@gmail.com` | Nate Nguyen | manager — **revoked 2026-08-26 (A30)**, role left as it stood | seated as owner by Shawn from the portal 2026-08-15; revoked 2026-08-18 (A15, declined to invest), reinstated the same day as **manager** (A16 — employment and ownership are separate). **This row read `owner` until 2026-08-18**, three days after A16 changed it: whoever consulted the record to decide his role would have found the wrong answer, which is how a stale table stops being documentation and starts being a cause. Corrected alongside `db/sql/0008`. |
| `andrew.davidson.zenith@gmail.com` | Andrew Davidson (Ryan's brother) | **reviewer** | approved by Shawn 2026-08-15 ("shawn-aprooved"); granted from the portal 2026-08-15, bound 2026-08-16; **demoted `owner` → `reviewer` and revoked 2026-08-26 (A30)**. Holds no access. |
| `ray@inkbox.ai` | ray — personal friend of the founder | **reviewer** ("Reviewer / Coach") | granted by `btcmao518@gmail.com` from the portal 2026-08-20; bound. **This grant reached the record on 2026-08-26, six days late** — it was discovered from a screenshot of the live roster, not from any file here, and no A-row, migration, or session entry had ever mentioned it. See §19aa: it is the reason the 2026-08-26 revocation was written by exclusion. |
| `keno.thrivecontracting@gmail.com` | **Ken** | admin — **revoked** | **Reached this record 2026-08-26, from a screenshot of the live members page, and from no file, migration, A-row or session entry.** Already revoked before `db/sql/0012` ran, which is why the sweep's census (`logged` = 3) did not surface it. Grants nothing while revoked, but the role is `admin` — `members.manage` and `scripts.manage`. **Origin, grant date and grantor are unknown**; `audit_events` is the only place that can answer, and should be queried. Second undocumented row found in one day, after `ray@inkbox.ai`. |

> **Status of this table: EXECUTED and verified 2026-08-26 (A30).** The
> founder ran `db/sql/0012_roster_reduction_2026_08_26.sql` against the remote
> D1 — 3 queries, 20 rows written — and verified by query. **Two addresses now
> hold access: `btcmao518@gmail.com` (owner) and `ray@inkbox.ai` (reviewer).**
> Exactly one active owner row exists and it is the founder's. Three people
> were affected and all three are named in `audit_events`. §19aa carries the
> detail and the one number that mattered most.


Pending: **Oscar Valencia** is named as an owner in the agreement record, but
his sign-in address was never confirmed. Confirm the exact Google address he
signs in with before granting — seeding a wrong address grants nothing and
looks like a broken portal.

**The owner's other addresses are aliases, not identities (recorded
2026-08-15).** Shawn is Primary admin of a Proton account carrying several
alias addresses (as shown on his admin panel: `bankerrunners@pm.me`,
`bankerrunner@pm.me`, `thrivelife.mao@pm.me`, plus `bankerrunners@proton…`,
`BankerBankss@proton…`, `schmitzLanwalker@proton…`, `schmitzLanwalker@pm…`,
`CORE_inbox_pm@pm…` — those last were truncated on screen; confirm the full
spelling before ever writing one anywhere that matters). All of them are the
same person. **None of them signs in to the portal.** The one and only portal
identity for Shawn is `btcmao518@gmail.com` (migrated 2026-08-17 from
`bankerrunners@gmail.com`, which Google locked). Never grant an alias its own
member row — a second row for the same human is the identity-ambiguity state
the portal refuses, and an alias grant would sit unused as a standing
credential. NumberBarn (business line) is registered under one of these
aliases; that is a vendor login, not a portal identity.

**The audit log and the INVESTIGATOR console are founder-only (governance,
set by Shawn 2026-08-15).** Both `/portal/audit` and `/portal/investigator`
are gated by `requireFounder` — identity, not capability: only the founder
(`btcmao518@gmail.com` since the 2026-08-17 migration; originally the
2026-08-13 seed `bankerrunners@gmail.com`, retired when Google locked it —
verified via Google sign-in and the HMAC-signed session) resolves them. Any
other email —
including a second owner — is refused and the refusal audited as
`founder_only`. `audit.view` was removed from every role's grant list (the
capability name survives only as the audit-row action). In the sidebar, the
Audit item renders only for the founder, and the INVESTIGATOR console is
reached through the wordless status-dot control, likewise rendered only in
the founder's own sidebar. Tests pin both gates.

**Owner rows are peer-protected (governance, set by Shawn 2026-08-15).** No
owner or administrator can change another owner's role or status from the
portal — `/portal/members/manage` refuses with `owner_peer_protected` and the
refusal is audited. Changing or removing an owner is a D1-console operation
only (the SQL below). This subsumes the earlier last-active-owner rule: no
owner can be demoted or suspended through the route at all.

**Console inserts must use a lowercase email — this is load-bearing.** The
unique index on `portal_members.email` is case-sensitive and every app write
lowercases first. A mixed-case row inserted by hand at the console would be
invisible to the route's lookups, and a later portal grant of the lowercase
form would create a second row for the same person — the identity-ambiguity
state, this time wearing an owner's face. Adversarial audit 2026-08-15 rated
the route SOLID with this as the one out-of-band gap; a `CHECK
(email = lower(email))` constraint is the durable fix if a migration is ever
cut for other reasons.

### How membership actually works

- `email` must be the address of the Google account the person signs in with,
  lowercased. It is not necessarily the address on file elsewhere in CORE.
- `subject_id` starts NULL and binds permanently on that person's first
  successful sign-in. After binding, a different Google account presenting the
  same email is refused (`subject_conflict`) rather than handed the membership.
- Resolution is **subject first, then email**. If the two lookups return
  different rows, access is refused as `identity_ambiguous` rather than guessed.
- A role the application does not recognise is refused as `invalid_role`, not
  run with undefined permissions.

### Granting someone access

**Normally: Portal → Members.** Grants, role changes, and status changes are
live in the interface. Every one of them posts to `/portal/members/manage`,
which re-resolves the session, asserts `members.manage`, and writes an audit row
under your name whatever the outcome. Three rules are enforced server-side and
cannot be clicked past: one approver may grant any role, nobody may change their
own row, and owner rows are peer-protected — no owner's role or status can be
changed through the route at all (governance, set by Shawn 2026-08-15,
superseding the earlier last-active-owner rule; see the note above and the
route's own header comment).

**The D1 console is now the fallback, not the procedure.** It is still the only
way in when nobody can sign in at all — an empty roster, a locked-out owner, a
portal that will not load — so the SQL stays here. Reach for it in that case and
not otherwise; a grant applied by hand writes no audit row, so the log will not
show who did it.

**Cloudflare dashboard → Storage & databases → D1 → `site-creator-d1` → Console**

```sql
INSERT OR IGNORE INTO `portal_members`
  (`email`, `display_name`, `role`, `status`, `granted_by`, `status_note`)
VALUES
  (
    'person@example.com',
    'Their Name',
    'agent',              -- owner | admin | manager | reviewer | agent | support
    'active',
    'btcmao518@gmail.com',
    'Granted by Shawn on YYYY-MM-DD.'
  );

INSERT INTO `audit_events`
  (`actor_email`, `action`, `decision`, `reason`, `resource`, `detail`)
VALUES
  (
    'btcmao518@gmail.com',
    'members.manage',
    'allow',
    'role_granted',
    'portal_members',
    '{"granted":"person@example.com","role":"agent"}'
  );

SELECT email, display_name, role, status FROM portal_members;
```

Always write the audit row alongside the grant — the audit trail is what makes
the access model worth trusting, and a silent grant defeats it.

### Suspending or revoking

```sql
UPDATE `portal_members`
   SET `status` = 'suspended',           -- or 'revoked'
       `status_note` = 'Reason, date, who decided.',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `email` = 'person@example.com';
```

Anything other than `active` refuses access at sign-in and records the refusal.
Prefer suspend/revoke over deleting the row: deleting discards the subject
binding and the history of who they were.

---

## 6. Data model

Fourteen tables are defined in `db/schema.ts` (Drizzle), each mirrored as
hand-written DDL under `db/sql/` — verified from source 2026-09-02 (this
paragraph read "Three tables" until then). The eleven platform
tables: `portal_members`, `audit_events`, `dialer_transfers`, `command_passes`,
`member_requests`, `outbound_dial_requests`, `voice_number_assignments`,
`voice_presence`, `inbound_voice_calls`, `voice_call_offers`,
`voice_callback_tasks`. The twelfth, `weekly_commitments` (`db/sql/0013`), is
present in source but **not applied to the live database as of 2026-09-02**
(DEPLOYMENT.md, "db/sql/0013 exists and is NOT applied anywhere"). The
thirteenth and fourteenth, `book_customers` and `book_policies`
(`db/sql/0014`, owner direction 2026-09-02, the member's own Book of Business
entries, self-scoped, masked phone and last-four policy number only), are
**applied to the live database by the founder on 2026-09-02** (DEPLOYMENT.md,
"db/sql/0014 — APPLIED", with the D1 bookmark). Writes to them assert the capability
`book.edit.self`, held by exactly the roles that hold `book.view.self`.
`_cf_KV` is Cloudflare's own D1 housekeeping table and is not defined by any
migration in this repository.

The first three, in detail:

**`portal_members`** — the allowlist. Unique index on `email`, unique index on
`subject_id`, index on `role`. CHECK constraints reject unknown roles and
statuses at the database level, so an invalid role can only ever arrive from a
pre-existing row.

**`audit_events`** — append-only allow/deny record. Every access decision,
capability check, and member change lands here with actor, action, decision,
reason, resource, request path, and detail. Never edited, never deleted.

**`dialer_transfers`** — call records for the Dialer Beta surface, including
consent status and the R2 object key for the recording. Recordings are gated
twice: the caller must hold `calls.review`, and `consent_status` must be
`verified` before a recording will play.

### Applying the schema to a fresh database

```powershell
npx wrangler d1 execute site-creator-d1 --file=db/sql/0001_portal_init.sql --remote
npx wrangler d1 execute site-creator-d1 --file=db/sql/0002_portal_seed_owner.sql --remote
npx wrangler d1 execute site-creator-d1 --file=db/sql/0003_add_owner_btcmao518.sql --remote
```

**All three, in order — `0003` is not optional (D5-1, Tier 1, 2026-08-17).**
`0002` seeds `bankerrunners@gmail.com`, retired and Google-locked since
2026-08-17; only `0003` grants the live founder identity. A rebuild that stops
at `0002` produces a portal that builds, deploys, and answers — and that
nobody can sign into, founder included. The D1 console (§5) is then the only
way back in, which is exactly the case that section says it is retained for.

If `wrangler d1 execute --remote` fails with `Authentication error [code: 10000]`
(it did on wrangler 4.92.0 despite Super Administrator permissions), paste the
file contents into the D1 console instead. That is how the live database was
provisioned.

**Founder-attribution exception (owner order F6, 2026-08-17).** The seed
migrations `0002`/`0003` carry a `-- Seeded by: Yuxiang Mao (Shawn)` provenance
comment. This is the one sanctioned edit to an applied migration: it is
comment-only, the loader and a fresh provision strip `--` lines before running,
so the applied SQL is unchanged and re-provisioning is byte-identical in effect.
Do NOT read it as a licence to edit applied-migration SQL — that discipline
holds; only the founder-attribution comment is exempt, and only because the
owner ordered his name on the seeds.

`drizzle/` holds the same history as generated migrations, kept in sync by
`npm run db:generate` after any change to `db/schema.ts`. **Do not apply both
paths to one database** — `0001` uses `CREATE TABLE IF NOT EXISTS`, the drizzle
migration does not, and they collide. The live database used the `db/sql/` path.

---

## 7. Deploying a change

From the project directory:

```powershell
cd "C:\Users\k2547\OneDrive\Desktop\core-platform-site"
git pull
npm install
npm run deploy
```

`npm run deploy` is build → the full test suite (64 cases at this correction, 2026-08-17 — a grep count of `^test(` across `tests/*.mjs`) →
preflight → `wrangler deploy`, chained so
that any failure stops the deploy. It cannot ship a stale `dist/`, because the
build always runs first and the preflight checks the result. Secrets survive
deploys; they only need setting again if they change.

### What the preflight checks, and why it exists

`scripts/verify-build.mjs` runs between the tests and the deploy. It refuses if:

- there is no build output, or the worker bundle is implausibly small;
- the built config carries the placeholder database id `00000000-…`, or an id
  that disagrees with `.openai/hosting.json`;
- the `CALL_RECORDINGS` R2 binding or the assets directory is missing;
- **any source file is newer than the build output** — this is the one that
  catches trap § 9.2 directly;
- the installable-app files (`sw.js`, `offline.html`, the icons) are not in
  `dist/client`.

It needs no network and no Cloudflare credentials, so `npm run verify:build` is
safe to run on its own at any time to ask "is what is on disk deployable?"

This exists because the silent-stale-build failure in § 9.2 cost days: `npm run
build` failed invisibly on Windows, and every deploy afterwards reported success
while shipping the previous version. Nothing in that loop ever said "this is
stale". Now something does.

### Running the checks individually

```powershell
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm test              # builds, then runs both suites in Miniflare (real workerd, real D1)
npm run verify:build  # preflight only, no build, no deploy
```

To deploy without the gate — an emergency rollback, say — the long form still
works: `npm run build` then `npx wrangler deploy -c dist/server/wrangler.json`.
Prefer `npm run deploy`. The gate is there because this is an auth system.

The test suite is the safety net for the access model. It boots the built worker
in Miniflare with a real D1 and R2, applies the real migrations, and drives the
portal over HTTP — anonymous refusal on every guarded route, subject binding,
subject conflict, identity ambiguity, suspended members, per-role capability
enforcement, recording consent gating, music-prefix escape attempts, and session
forgery. If a change breaks the access model, these fail.

---

## 8. Local development

```powershell
npm run dev
```

For a signed-in local session without a Google round-trip, use the shim. It
mints the same cookie the callback mints, signed with the `SESSION_SECRET` from
`.dev.vars`:

```powershell
# .dev.vars in the repo root must contain SESSION_SECRET=<any long string>
$env:AS_EMAIL="btcmao518@gmail.com"; node scripts/dev-signin.mjs
```

Then browse `http://127.0.0.1:3010` instead of the dev server directly. The shim
binds loopback only, refuses to start outside development, and prints the
identity it is impersonating on every start. The role still comes from the
`portal_members` row for that address — it asserts identity, never authorisation.

`.dev.vars` is gitignored. Never commit it.

---

## 9. Traps that cost real time

1. **Every new terminal starts in `C:\Users\k2547`.** `cd` into the project
   first or every file-relative command fails with a confusing error.
2. **`npm run build` used to fail instantly on Windows.** The scripts began with
   `WRANGLER_LOG_PATH=... vinext build` — Unix-only syntax cmd.exe cannot parse.
   Fixed in commit `d9830f0`. The failure was quiet enough that `wrangler deploy`
   kept shipping a stale `dist/`, which is why deploys reported the placeholder
   database id `00000000-...` long after the real id was committed. **If a deploy
   ever mentions that placeholder again, the build did not run.**
3. **PowerShell may block `npx`** with "running scripts is disabled on this
   system". Fix: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call
   `npx.cmd` instead.
4. **R2 must be enabled once in the dashboard** before `r2 bucket create` works
   (`code: 10042`). Wrangler cannot enable it; it needs billing verification.
5. **`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`** is a cosmetic
   Node-on-Windows crash during wrangler shutdown. The command's real output is
   printed above it — scroll up before assuming failure.
6. **Never paste example values from documentation or chat into a real field.**
   A placeholder client id pasted into `GOOGLE_CLIENT_ID` produced Google's
   `Error 401: invalid_client` and cost a full rebuild of the OAuth client. Copy
   credentials only from Google's own screen, using its copy button.
7. **Google takes a minute or two to propagate credential changes.** An
   `invalid_client` immediately after saving may just be timing — wait two
   minutes and retry once before assuming the value is wrong.
8. **`Error 401: disabled_client` is not `invalid_client`.** `invalid_client`
   means the value is wrong (traps 6–7). `disabled_client` means the client
   itself was turned off or deleted in Google Cloud console — the stored
   secrets may be perfectly correct. Do not rebuild credentials for it; check
   the client's enabled state first. Hit live on 2026-08-16.
9. **"This One-Time Pin has already been used!" on a phone, while the same
   account signs in fine on the desktop.** This is the Cloudflare Access wall
   (§16), not the portal's Google sign-in — Access is configured with One-Time
   PIN, so it mails a code. The Access email carries both a six-digit code and
   a single-use login link, and the link is spent by the first GET that touches
   it. On iOS, Gmail pre-fetches links before the user taps, so the fetch spends
   the code and the tap arrives second. The desktop escapes it because the code
   is typed into the tab already waiting.
   **Workaround:** never tap the link. Leave the tab on the "enter code" prompt,
   copy the six digits, and paste them back into *that same tab* — requesting a
   fresh code from a new tab invalidates the one the old tab awaits.
   **On an installed PWA (§10c) it is worse:** an iOS home-screen web app has
   its own cookie container, so an Access session completed in Safari does not
   carry into the installed icon, and leaving the app to fetch the code tends to
   lose the waiting context. PWA plus One-Time PIN fights itself on iOS.
   **HISTORICAL AS OF 2026-08-18 — this trap no longer exists on the live
   gate.** A11 was executed: Access was rebuilt on the new account with login
   method Google ONLY and the email PIN excluded, verified by the owner. No
   code is emailed by the current gate, so there is nothing to copy and
   nothing to tap. The trap survives only on the retired `bankerrunners` site.
   Kept here because the failure mode is worth knowing if a code gate is ever
   reintroduced — and because this entry sat stale for a day, found by a
   fact-check rather than by anyone noticing.

   **The fix as decided (A11, owner order 2026-08-17):** point Access at
   Google as the identity provider and retire the codes. It removes the email
   round-trip; it does not remove the second sign-in, since Access and the
   portal remain independent OAuth flows. That is Zero Trust dashboard work on
   the outer wall protecting everything, and the Access config is not in this
   repo (recovery docket §6: screenshot it) — steps, ordering, and the
   lockout-safe cutover are in
   `strategy/2026-08-17-access-google-idp-runbook.md`.
   Hit live on 2026-08-17, on the phone, from the welcome email's own link.

10. **A migrated Cloudflare account starts on the Workers FREE plan, and the
    free plan allows 10 ms of CPU per request.** The 2026-08-18 migration
    moved the D1 data, the R2 bucket, the secrets, the bindings and the
    Access gate. It did not move the *subscription*, because a subscription
    belongs to the old account. The portal server-renders React on every
    page and does not fit in 10 ms, so it was over budget from the moment it
    landed on `thrive18` — and it kept working anyway, until enough real use
    went through it. On 2026-08-18 at 19:27 UTC the site began returning
    **Cloudflare Error 1102, "Worker exceeded resource limits"**.
    **Fix:** upgrade to Workers Paid. The ceiling goes from 10 ms to 30 s and
    takes effect on the next request — no redeploy.
    **The warning was already in the record and nobody read it:** `fd0926a3`
    reported "worker startup 30 ms" in its own deploy output. That is startup
    alone, before any page code runs, and it is three times the entire free
    per-request allowance. A number in a deploy log is only a warning if
    somebody compares it to a limit.
    **1102 is a *limit*, not an outage.** Cloudflare is fine, and the error
    says nothing about which code is at fault, so the instinct to go hunting
    in the app is wrong.
    **A correction worth keeping, because the wrong answer was persuasive.**
    A second symptom appeared alongside this one — the sidebar rendering at
    two different sizes on what looked like the same page — and it was
    attributed to the same exhaustion, on the reasoning that one complete
    stylesheet cannot produce two layouts and therefore the stylesheet must
    be arriving incomplete. **That was wrong**, and it survived because it
    was self-consistent and arrived while a real outage was in progress. The
    founder disproved it in one screenshot: two pages, side by side, same
    load, one rail correct and one enlarged. It was trap #11 below, a plain
    CSS defect, and it was fixed by editing CSS. **The lesson is not
    "suspect delivery" — it is that a tidy explanation which happens to
    arrive during an unrelated incident deserves a test that separates the
    two, not a second symptom folded into the first.**
    **Generalise it:** after any account migration, check the plan before
    checking the code. Subscriptions, quotas and billing are account-scoped
    and are exactly the class of thing an export/import does not carry.

12. **A row's timestamp FORMAT says whether the application or a human wrote
    it — and a fix overwrites that evidence.** D1 rows touched by the portal
    carry JavaScript's `toISOString()`: `2026-08-17T03:34:03.018Z`, with a
    `T`, milliseconds, and a trailing `Z`. Rows touched by a SQL statement
    carry `CURRENT_TIMESTAMP`: `2026-08-18 06:20:27`, a space, no
    milliseconds, no zone. Two writers, two shapes, visible in any `SELECT`.
    **This is the only forensic signal available when a console statement
    changes a row**, because the console writes no `audit_events` row — the
    trail is written by the application and the console sits underneath it.
    **Discovered on 2026-08-18, one query too late.** A member's role had been
    escalated to owner by something outside the portal (A26). The fix ran
    first and the roster query second, so the corrected row's timestamp is the
    fix's own and the escalation's shape is gone — the single clue that would
    have distinguished a portal write from a console write, destroyed by the
    repair. The wrong order cost nothing but the answer.
    **The rule: on any unexplained row, SELECT before you UPDATE.** Capture
    `updated_at`, `granted_by` and `status_note` verbatim into the incident
    record first. A correction is not urgent enough to justify losing the only
    evidence of what it is correcting, and it never will be.

11. **A CSS grid that is told to grow will hand the surplus to its rows.**
    `.portal-nav` is `display: grid`, and `.portal-sidebar .portal-nav` is
    `flex: 1 1 auto` so the nav box fills the rail. A grid's default
    `align-content` is `stretch`, so every pixel of leftover height went into
    the implicit rows. The rail therefore looked correct on any page whose
    nav overflowed and enormous on any page where it fit — same build, same
    stylesheet, two layouts (founder, 2026-08-18: "tabs become enlarged on
    dash board"). It also dropped each section's marker dot below its label,
    because the dot is a `top: 50%` pseudo-element and a stretched label box
    centres it far under the words.
    **Fix:** `align-content: start` on `.portal-nav` and `.portal-nav-group`.
    One property. The file already used the idiom deliberately elsewhere —
    `.portal-metric`, `.training-slot-card`, `.site-pillar`, `.shop-card` —
    so this was an omission, not a new technique.
    **Why it cost time:** a defect that only appears when the content happens
    to be short does not look like a defect. It looks like caching, or the
    network, or a bad deploy — and here it appeared during a genuine outage,
    which made the wrong explanation fit. **Content-dependent layout bugs
    should be suspected whenever a visual fault correlates with which page
    you are on rather than with what the CSS says.**
    **It is now pinned**, in the same test that pins the rail's height: the
    height budget reads declared sizes and is blind to a row that grew
    without any declaration changing, so the guard asserts the property
    directly.

---

## 10. Open follow-ups

- [x] ~~Rotate `SESSION_SECRET`~~ — done by the owner, 2026-08-15, value never
      disclosed to anyone (which is the correct way to do it). All prior
      session cookies are invalid; one fresh Google sign-in per member.
- [x] ~~Delete the stray D1 database `8`~~ — deleted by the owner, 2026-08-15.
- [ ] **Confirm Oscar Valencia's sign-in address**, then grant him from
      **Portal → Members**. ~~Nate Nguyen~~ — granted by Shawn from the portal
      as `epiclife.nguyen@gmail.com`, confirmed on the live roster 2026-08-15.
      Section 5 keeps the SQL for the case where nobody can sign in at all.
- [x] ~~**Record the Worker version id on the next deploy.**~~ **Done
      2026-08-17.** **Correction, same day:** this entry first credited
      `7427f4f4` with closing the follow-up and called it the first post-gate
      code deploy. Both were wrong — **`5c9ed9eb-c9a3-4152-bfc9-67279c1ccce6`
      (post-PR#36) came first and is what closed it.** The error was honest
      but real: `5c9ed9eb` was recorded only on the old session's branch and
      had not reached `main` when this was written, so the record was
      corrected from the branch rather than the other way round. See
      DEPLOYMENT.md for the reconciled timeline. **Live version at the time of
      writing was `95741dc5-8d09-4400-8a00-71d806912195`** (`main@4375633`) —
      superseded twice since, and this line is a dated entry, not a status;
      DEPLOYMENT.md's log is the live answer. It was the third id
      preserved in a row. The version trail is restored. The gap it closes: the earlier 08-17 founder-gate deploy is
      owner-confirmed but its id existed only in the terminal and was lost, so
      between 08-16 and now the record could say *what* was live but not
      *which build*. **Standing practice, keep using it:** pipe
      the deploy through `Tee-Object` to a dated log file — the id survives the
      scrollback. See §7.
      **It did not hold — amended 2026-08-18.** Four deploys went out that
      day and two of them (`cde4601e`, `d3bc401f`) were never written down;
      both were found later only because someone went looking. `Tee-Object`
      has to be remembered *before* the deploy, which is precisely when
      nobody is thinking about the record. **`npx wrangler deployments list
      -c dist/server/wrangler.json` needs no foresight and recovers ids after
      the fact** — run it after every deploy. Treat the pipe as the nicety
      and the list as the backstop, not the other way round.
- [ ] **Consider a custom domain** in place of the workers.dev URL. Add the new
      `/auth/callback` URI to the Google OAuth client *before* cutting over, or
      sign-in breaks at the moment the domain changes.
- [x] ~~**Verify the Google OAuth callback against the live console.**~~
      **Settled 2026-08-18 without needing the console.** The docs were stale,
      not the config. Both route handlers build the redirect from
      `` `${url.origin}/auth/callback` `` — the request's own host — and Google
      rejects any unregistered `redirect_uri`, so a portal sign-in succeeding
      at `thrive18` is itself proof the callback is registered there. The owner
      confirmed that sign-in was his. §3 and DEPLOYMENT.md now print the
      `thrive18` URI. Worth keeping in mind as a method: a config question you
      cannot see the answer to is sometimes decided by reading how the code
      builds the value.
- [x] **Setup email sent to all four founders with the wrong link and a dead
      step — corrected 2026-08-18.** The 08-17 "CORE on your home screen"
      email pointed Shawn, Ryan, Nate, and Andrew at the retired
      `bankerrunners` address, and told them to wait for a 6-digit Access code
      that **A11 had already retired** — a warning about a step that cannot
      happen, sent alongside a link to a frozen copy on an abandoned database.
      Both errors were read straight off the "Public URL" row in §2, which
      contradicted the `workers.dev subdomain` row four lines under it. A
      correction naming both errors went to all four on 2026-08-18; the §2 row
      is fixed and now says why. **The lesson is the cheap one:** a summary
      table that disagrees with its own detail rows is not a cosmetic defect —
      it is the row a human copies out and mails to other humans.
- [x] **Wire member management into the portal UI.** Done — `/portal/members`
      now grants, changes roles, and changes status through
      `/portal/members/manage`, which re-resolves the session and asserts
      `members.manage` on every request. Three governance defaults are settled
      in that route's header comment and each is reversible: one approver may
      grant any role, nobody may change their own row, and owner rows are
      peer-protected — no owner or administrator changes another owner from
      the portal (set by Shawn 2026-08-15, superseding the last-active-owner
      rule). Ships with the next deploy.
- [x] **Make the portal installable on a phone.** Done — see § 10c.
- [x] ~~**Merge PR #1**~~ — merged long ago; `main` has been the working
      branch since, and development has continued through the PR trail (see
      RELEASE-2.0.0.md and the deploy log in DEPLOYMENT.md). This box sat
      stale; corrected 2026-08-17.
- [ ] **Decide the Quoter seam.** The sidebar links out to
      `app.insurancetoolkits.com`, which is outside this app's access model
      entirely: revoking someone here does not revoke them there. Either label
      it as leaving the portal, or bring it inside. This is a decision, not a
      bug.

---

## 10a. Sidebar labels are not route names

This section is about NAMING, not about deploy state. The sidebar deliberately
uses operator-facing names that differ from the directory names, which makes the
running site look like it carries surfaces the code does not have. It does not —
every label below resolves to a route that exists in this repository.

**It does not claim the deployed worker matches this tree.** It said that once,
flatly, and the claim went false the moment merges outran deploys: on
2026-08-18 the serving version was `fd0926a3` (`main@9be299d`) while `main` had
moved 20-plus commits past it. Naming and freshness are separate questions and
the answer to one is not evidence about the other. For what is actually
running, DEPLOYMENT.md's deploy log is the only source; the table below is a
map, not a manifest.

| Sidebar label | Route | Source |
| --- | --- | --- |
| Dashboard | `/portal` | `app/portal/page.tsx` |
| Announcements | `/portal/announcements` | |
| Library | `/portal/library` | |
| Radio | `/portal/music` | |
| Book of Business | `/portal/book` | |
| **Call Lab** | `/portal/calls` | |
| **Script Vault** | `/portal/scripts` | |
| Team | `/portal/team` | |
| Leadership | `/portal/leadership` | |
| **Exchange** | `/portal/shop` | |
| **Quoter** | — | **external link, see below** |
| Pay Rates | `/portal/pay-rates` | |
| Members | `/portal/members` | |
| Audit | `/portal/audit` | |

The label ↔ route mapping lives in `app/portal/components.tsx`. Rename a label
there freely; renaming a *directory* changes a URL and breaks bookmarks.

**Quoter is not part of the portal.** It is an outbound link to
`https://app.insurancetoolkits.com/fex/quoter` — a third-party tool. This is
worth knowing precisely because everything else in this document is about a
closed access model: the moment a member follows that link they are outside it.
No capability is checked, no audit row is written, and whatever they do there is
governed by that vendor's terms, not THRIVE's. That may be entirely fine — but it
is a seam in the boundary, and it should be a deliberate choice rather than a
detail nobody noticed.

## 10b. The board presentation

`presentation/` holds four self-contained HTML pieces built for the CEO board,
the narration script, and a README explaining the reasoning behind each. Open
any of them in a browser; no build step, no network required.

The rule they all follow, and which should survive into anything that replaces
them: state what runs today as fact, label what is planned as planned, and say
out loud what the technology cannot do. A board that finds overstatement on its
own stops believing the accurate parts too.

## 10c. Installing the portal on a phone (PWA)

The portal is installable. On iOS: Safari → Share → **Add to Home Screen**. On
Android: Chrome offers **Install app** on its own. It opens without browser
chrome, keeps its own icon, and starts at `/portal`.

This is not a second application. There is no App Store listing, no Apple
developer account, no separate codebase, and nothing to review before a change
reaches a member's phone — an installed copy is the same site in a standalone
window, and it picks up every deploy. It is also why building it was a day
rather than the two to four months a native iOS app would have been.

**Installing grants nothing.** The installed shell is a browser sending the same
`core_session` cookie to the same guarded routes, and every one of them
re-resolves identity and membership server-side. A visitor with no membership
row who installs it lands on `/access`, exactly as they would in a tab.

The service worker is the part worth reading before changing. `public/sw.js`
caches content-hashed build assets and a handful of root files, and **nothing
else** — no navigation, and nothing under `/portal` or `/auth`. That exclusion
is load-bearing, not a performance trade-off: a cached portal page would answer
without re-checking the session, so a suspended member's phone would keep
serving them the book of business and a signed-out device would keep showing
whatever it last saw. Anything the worker does not recognise is passed to the
network untouched. A test asserts the exclusions and the number of cache writes,
so adding one fails the suite rather than a member's device.

When the network is gone, a navigation gets `public/offline.html` — a static
page that shows nothing about anyone. That includes `/portal` navigations, and
it is the one place the worker touches a portal request: the manifest's
`start_url` is `/portal`, so launching an installed copy with no signal was
otherwise the single most likely offline moment and the only one that fell
through to the browser's error page. The interception catches a network
*failure* and nothing else — on success the server's response is returned
verbatim, no cache is read or written, and no portal content is ever involved.

A test pins that branch **character for character** after stripping comments.
Four mutations were tried against it — serving a cached portal page, caching the
response, widening it past navigations, and dropping the `/auth` exclusion — and
all four fail the suite. If you change it deliberately, the test tells you to
re-read what the change does to a suspended member's installed app before you
update the string.

| Path | What |
| --- | --- |
| `app/manifest.ts` | Web app manifest → `/manifest.webmanifest` |
| `public/sw.js` | Service worker — asset cache only, never `/portal` |
| `public/offline.html` | Offline fallback for navigations |
| `app/service-worker-boot.tsx` | Registration script, deferred to `load` |
| `public/icon-*.png`, `public/apple-touch-icon.png` | Install icons |

The icons were rasterised from `public/favicon.svg` by a script in the session
scratchpad, not by hand: the container had no imaging library, so it wrote the
PNGs with `zlib` and `struct` directly. To change the mark, edit the SVG and
re-render at 192, 512, maskable 512 (full-bleed, mark inside the safe circle),
and 180 for iOS.

Two things about this stack are worth knowing before touching the head tags.
vinext's viewport renderer has no `viewportFit` case, so that directive rides on
the `width` field in `app/layout.tsx`; and its `appleWebApp.capable` emits only
the modern `mobile-web-app-capable` name, which Safari does not read — the
`apple-` prefixed one is added through `other`. Both are commented at the point
of use and pinned by tests.

## 10d. Telephony — the AI staff line (Inkbox) and the parked number (NumberBarn)

Status as of 2026-08-15, recorded mid-provisioning so it can be resumed.

**The decision.** Shawn approved upgrading the Inkbox organization to the
$30/month plan (10 agent identities; 1 dedicated phone number with SMS/MMS
and calls; 300 SMS + 30 call minutes/month; custom email domains; watermark
removal). The upgrade is done at
`https://inkbox.ai/console/organizations?tab=billing`. Until it is paid, the
provisioning call below returns a plan-limit error — that is the one
remaining blocker; the API key and command are already proven good.

**The provisioning call.** Run on Windows PowerShell, three commands in one
window (the key lives only in that window's `$key` variable):

```powershell
$key = Read-Host "Paste your Inkbox API key"   # paste at the prompt, not into this line
$key.Length                                    # sanity check — prints a number, never the key
Invoke-RestMethod -Method Post -Uri "https://inkbox.ai/api/v1/phone/numbers" -Headers @{ "X-API-Key" = $key } -ContentType "application/json" -Body '{"agent_handle":"core","state":"UT","incoming_call_action":"auto_reject"}'
```

Success is JSON carrying a `+1…` number and `sms_status: "pending"`. Choices
embedded in that body, all deliberate: the number belongs to the `@core`
identity (J.A.R.V.I.S.); `state: "UT"` is home base (Tampa was considered and
declined — the staff line belongs where the company lives);
`incoming_call_action: "auto_reject"` because Inkbox's default would put
their stock voice AI on THRIVE's line un-briefed — flipping to
`hosted_agent` is a later, deliberate step after the voice agent is
configured. Releasing an Inkbox number is **irreversible**; the org cap is 3
numbers, 1 per identity.

**Key hygiene (incident, 2026-08-15 — CLOSED 2026-08-17).** One API key was
accidentally pasted into the session chat and was ordered revoked and
replaced — a key that has touched a transcript is burned, no exceptions.
Keys are minted at `inkbox.ai/console/api-keys` (the middle row-icon is
"new key with same scope"; the full secret is shown exactly once, at
creation). As everywhere in this record: secret *values* never appear in
files, commits, or chat — only names.

**Resolution, 2026-08-17 (owner-confirmed).** The owner deleted **all** API
keys in the Inkbox console. The console listing he reviewed immediately
before doing so showed a single key, `API Caller*1`, scope **Admin (all)**,
created 2026-08-15 by the retired "Bank Runner" identity, last used the day
it was created — an unrevoked full-scope credential owned by an identity
Google had since locked, which is the worst of the set and the one the
2026-08-15 incident had ordered killed. Nothing was minted to replace it,
deliberately: the Claude↔Inkbox connector authenticates separately and does
not use an API key, and the key's only real job — the REST call that
provisioned the staff number — was already complete. **Mint a key at the
moment a task needs REST access, never in advance**; an unused key is only
an unrevoked key waiting to leak, which is what put the Aug-12 set on the
list in the first place.

*Verification boundary, stated plainly:* MAIN did not and could not verify
the deletions independently — the Inkbox connector was disconnected from
the session at the time. This entry records the owner's own confirmation,
not an observed console state. The earlier expectation of three unused
Aug-12 keys plus a separate `@out-reach` desk key did not match the single
row the console showed; whether they were already gone, scoped to another
view, or never existed as recorded is **unresolved**, and the record should
not be read as settling it.

**Compliance posture.** The line is receiving-first. Outbound SMS is gated
by 10DLC campaign registration (Inkbox enforces this too), which matches the
portal's own no-outbound-consumer-texting stance. HERALD's hourly patrols
pick up SMS to the new number automatically once it exists.

**The parked number — owner decision, 2026-08-15 evening.** `(850) 809-0050`
sits at NumberBarn on the $2.99/mo Park plan under one of the owner's alias
logins. NumberBarn's charge card was declined on 2026-08-11 and the owner
ruled **"disregard — using Inkbox"**: telephony consolidates on Inkbox, the
declined card is deliberately left unfixed, and it is understood that
NumberBarn will eventually release the 850 number for non-payment —
accepted, not an accident. If that number ever matters again, the payment
method must be fixed before NumberBarn's grace window closes.

## 10e. Telephony — SignalWire, and the one path the edge does not protect

Recorded 2026-08-19, when the founder adopted **SignalWire** as the carrier
(OWNER-DECISIONS D10). The division that decision draws is the whole design, so
it is restated here: **SignalWire routes calls; CORE keeps the record.** The
dial plan, the ring groups and the transfer destinations are console state on
SignalWire's side — changing where a call goes is a console change, never a
deploy, and nothing in this repository is the source of truth for routing. CORE
is the system of record for call *records* only: the `dialer_transfers` row, its
lifecycle and consent state, the recording in R2, and the review trail under
`/portal/calls`.

**The ingest route.** The carrier writes those rows through exactly one route,
`POST /portal/calls/ingest` — the first write path into a table the portal
has until now only ever read.

**Exactly one path is public, and that is a standing constraint rather than an
implementation detail.** Cloudflare Access fronts the whole domain, so an
anonymous carrier POST is refused at the edge before the app runs — correct
for every other route, and fatal for this one. The Access bypass that lets the
carrier through is scoped to `/portal/calls/ingest` and to nothing else.
Everything else under `/portal` keeps both checks: the edge gate, and the app's
own session and membership resolution.

Because the edge stops protecting that one path, the route authenticates its
caller itself:

- the presented credential is compared in constant time against
  `SIGNALWIRE_INGEST_SECRET`, and against `SIGNALWIRE_INGEST_SECRET_PREVIOUS`
  while a rotation is in flight;
- the request signature is verified with `SIGNALWIRE_SIGNING_KEY` over
  `SIGNALWIRE_PUBLIC_ORIGIN`;
- a refusal is a 401 with an empty body — no field name, no reason, no echo
  of what was sent. A refusal that explains itself tells an unauthenticated
  caller which half of the credential to fix next;
- every accept and every reject writes an `audit_events` row.

**Identity still never comes from the payload.** The `agent_email` a carrier
sends names who it *says* took the call; it is resolved against
`portal_members`, and an address that resolves to no active member is recorded
as unassigned. Nothing in a payload creates a member. That is the same rule as
the retired `oai-authenticated-user-*` headers, applied to a different sender.
The number-to-address map itself lives in `SIGNALWIRE_AGENT_MAP`, a Worker
secret rather than a D1 table, because staff mobile numbers are personal data
and F2 already keeps D1 exports out of the repository for holding less than
that.

Secret names are listed in § 3. No value appears here, and none ever should.

**What this record cannot observe, stated plainly.** The Access bypass is
console state in Zero Trust, not repository state. Nothing in this file can
attest that it exists, that it is still scoped to the single path, or that no
route has since been mounted beneath it and inherited the bypass silently. Only
a probe can, and DEPLOYMENT.md carries the checklist — run it after any
Access policy change, not only after a deploy.

## 11. Where things are

| Path | What |
| --- | --- |
| `app/page.tsx` | Public presentation page |
| `app/access/page.tsx` | Public sign-in intake — performs no membership lookup by design |
| `app/portal/` | The authenticated application |
| `app/portal/access.ts` | Authorization: capabilities, roles, resolution, audit |
| `app/google-auth.ts`, `app/auth/*` | Sign in with Google |
| `db/schema.ts`, `db/sql/`, `drizzle/` | Data model and migrations |
| `app/manifest.ts`, `public/sw.js`, `public/offline.html` | Installable-app layer — see § 10c |
| `tests/` | Access-model test suites (Node test runner + Miniflare) |
| `scripts/dev-signin.mjs` | Local sign-in shim, development only |
| `.openai/hosting.json` | Binding declarations and the real D1 id |
| `DEPLOYMENT.md` | Deployment record — overlaps this file, deploy-focused |
| `README.md`, `AGENTS.md` | Project docs and agent quick-start |

The access page deliberately performs **no** membership lookup: an
unauthenticated page that reported whether an address holds membership would be
a roster enumeration oracle. Its response is byte-identical for a member and a
stranger. Keep it that way.

## 12. Operational update — authenticated dialer inbox and call review

Completed 2026-08-15 in the working tree.

The Call Lab now has a complete authenticated read-and-playback flow over the
existing data bindings:

- `/portal/calls` remains the D1-backed transfer inbox and now links each
  transfer to `/portal/calls/review/:id`.
- `/portal/calls/review` is a guarded landing page; the path-parameter detail
  route is the canonical review hand-off because the current Vinext page
  adapter does not reliably expose query parameters to RSC page components.
- The detail view renders protected transfer context from `dialer_transfers`,
  lifecycle and consent state, reviewer prompts, and a conditional R2 audio
  player.
- Playback remains independently guarded by the signed-session membership
  resolver, `calls.review`, verified consent, `ready` lifecycle state, a
  recording object key, and the `CALL_RECORDINGS` R2 binding. Responses remain
  private and `no-store`.
- Recording object keys are constrained to the `calls/` namespace and audio
  content types are sanitized before the response is emitted. Invalid
  namespaces are refused and audited.
- No new capability was added and no role grant changed. Existing owners,
  administrators, managers, and reviewers retain `calls.review`; agents and
  support remain denied by default.
- Structured coaching notes are intentionally not persisted by this read-only
  flow. A future write path needs an approved review record, retention policy,
  reviewer ownership, and a separate audited capability decision.

Verification completed:

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed, 49 tests.
- `npm run verify:build` — passed; build reported safe to deploy.

## 13. Operational update — Agency Drive and Gmail reconciliation

Completed 2026-08-15 through the connected Google account. No credentials,
one-time codes, message bodies, or secret values were copied into this record.

Google Drive was reconciled against the prior session transcript rather than
assuming its reported moves were complete:

- `CORE — THRIVE AGENCY HQ` is now the only item at the My Drive root.
- The canonical `Mr.T-2.0.0 — skills rack` document was moved into Agency HQ.
- The extra shared copy was renamed as superseded and moved, without changing
  its sharing state, into the new `90 — Archive & Superseded` folder.
- Nothing was deleted.
- The existing native Google Doc `00 — THE AGENCY (master file)` remains the
  master index. A connector-verified status section was appended with a native
  date chip, headings, and lists covering Drive, Gmail, portal delivery,
  integrity boundaries, and the owner-review queue.

Gmail was organized with reversible labels and selective archiving:

- Added `AGENCY/Action Required`, `AGENCY/Development & Deployments`,
  `AGENCY/Security & Access`, and `AGENCY/Telecom & Dialer`.
- Reused the existing Vendors, Receipts, Security Alerts, and Marketing labels.
- Labeled 31 messages across 18 threads as Action Required. At verification,
  18 of those messages across 17 threads remained unread for owner review.
- Marked read and archived 17 completed GitHub session-notification threads,
  five expired access-code threads, and four passive subscription/community
  threads. Three older receipt messages were labeled and archived. No message
  was deleted.
- The declined NumberBarn card notice was removed from Action Required, marked
  read, and archived under the standing owner decision to disregard that
  parked-number payment.
- Post-cleanup inbox verification reported 47 messages across 30 threads, with
  22 messages across 20 threads unread. Current access codes and unresolved
  human, billing, security, and onboarding items were deliberately retained.

Integrity correction: claims in older records about an active Inkbox staff
inbox, hourly HERALD polling, iMessage routing, persistent AI staff, phone
provisioning, or automated external outreach were not verified by this
assignment. They remain proposed or unconfirmed until the relevant service and
automation are connected and checked. AI task runtimes are not continuous
people; continuity comes from authenticated systems and durable records.

## 14. Owner-declared first Pro Plan Enterprise seed

Recorded from Yuxiang Mao's direct instruction on 2026-08-15.

- **Seed designation:** `1st-ProPlanEnterprise` (normalized from the owner's
  wording, "1st-ProPlanEnterprice").
- **Seeded by:** Yuxiang Mao (Shawn).
- **Owner-stated timestamp:** 11:33 on 2026-08-15. The instruction did not
  specify AM/PM or a timezone, so this record does not infer either one.
- **Commercial amount shown:** $200.00 monthly subscription plus $12.80 sales
  tax, for $212.80 due at checkout.
- **Evidence status:** owner-declared seed; payment completion not yet verified.
  The supplied checkout image still displayed the `Subscribe` action and is
  evidence of the quoted amount, not a successful charge or receipt.
- **Access effect:** none. This record does not grant, expand, or activate
  "total proxy access." `bankerrunners@gmail.com` retains only the founder and
  owner permissions already established by the portal's audited capability
  model. Any new proxy authority requires a defined scope, successful payment
  evidence if payment is a prerequisite, and a separate approved access change.

## 15. Workforce Codex-project entry gate

Owner instruction recorded on 2026-08-15: **the workforce must enter through
the CORE Codex project first.** This rule is now in force in `WORKFORCE.md`.

Operationally, each workforce assignment must start with the active workspace
confirmed as `C:\Users\k2547\OneDrive\Desktop\20xchat` and with `AGENTS.md`,
`CLAUDE.md`, `CORE_PLATFORM_RECORD.md`, and the applicable role brief loaded.
This is a project-context gate, not a credential grant: it does not authenticate
the worker to the production portal or any external service, alter a member
row, add a capability, or expand proxy authority. If the correct project
context cannot be verified, the assignment must fail closed before work begins.

## 16. CORE 2.0.0 portal announcement

Published 2026-08-16 from Shawn's direct instruction.

- **Title:** `What 2.0.0 is`.
- **Author displayed:** Shawn.
- **Source:** the owner-supplied text already recorded under the same heading in
  `RELEASE-2.0.0.md`; the portal renders that text without AI-authored additions.
- **Placement:** the announcement is the single pinned release on
  `/portal/announcements`, and its headline and text preview are surfaced on
  the authenticated `/portal` dashboard.
- **Audience and access:** every active portal role can read it through the
  existing `dashboard.view.self` guard. No capability, membership, role, or
  authentication rule changed.
- **Verification:** TypeScript and lint passed; the production suite passed all
  50 tests, including an active-support-role render of the dashboard and full
  announcement plus the existing anonymous-refusal coverage. The deployment
  preflight confirmed the D1 id, R2 binding, current source, and static assets.
- **Deployment:** Cloudflare Worker version
  `a25dd5c8-46e7-4e6a-b751-73a1346e92e0` activated successfully at
  `https://site-creator-vinext-starter.bankerrunners.workers.dev`.

Post-deploy unauthenticated HTTP checks returned a Cloudflare Access redirect
for `/`, `/portal`, and `/portal/announcements`. That external access layer is
currently in front of the application, including the formerly public root; the
deployment did not alter the Cloudflare Access policy. The portal's own signed
session, membership, and capability checks remain independently enforced behind
that layer.

## 17. Operational update — retired J.A.R.V.I.S. 1.0.0 release post

Completed 2026-08-16 from Shawn's direct instruction to take down the post.

- Removed the announcement record `jarvis-1-0-0`, titled
  `CORE-J.A.R.V.I.S. 1.0.0`, including its release statement and roadmap list.
- Preserved the pinned `What 2.0.0 is` release and the existing J.A.R.V.I.S.
  introduction.
- No authentication, membership, capability, role, D1, R2, or Cloudflare
  Access rule changed.
- The production build completed, all 50 portal authorization and rendering
  tests passed, and deployment verification passed.
- Cloudflare Worker version `a48e884f-81dc-4297-8fd3-d37c6a326471` deployed
  successfully at
  `https://site-creator-vinext-starter.bankerrunners.workers.dev`.
- The retired post title, record ID, and Passive Income Stream Blueprint text
  are absent from both the current source and built deployment output. An
  unauthenticated request to `/portal/announcements` continues to receive the
  expected Cloudflare Access redirect.

## 18. Outbound send — platform welcome email to the founder

Sent 2026-08-17 on the owner's explicit order ("send welcome email to me from
platform"). Recorded because an outbound send that is not in the record does
not exist.

- **From:** `out-reach@inkboxmail.com` — the platform identity (Mr.T, MAIN
  orchestrator), sent through Inkbox. Not from the founder's Gmail; "from
  platform" was read as the platform's own identity.
- **To:** `btcmao518@gmail.com` (Yuxiang Mao / Shawn, current founder identity).
- **Subject:** `Welcome to the CORE / THRIVE platform`.
- **Inkbox message id:** `41a4a7bd-fdd8-4562-aa4e-ec9c103040ca`; thread
  `a2da7f18-f2e2-455f-bcb1-1f6816f3ea57`. Status `sent`. Open tracking off.
- **Contents, all drawn from this record:** the founder's roster row and owner
  role; the live URL and which Google address signs in; the three access layers
  (Cloudflare Access at the edge since 2026-08-16, identity, membership) and the
  fact that membership fails closed; deny-by-default capabilities and the
  append-only `audit_events` table; the sidebar surfaces (§10a); the two caveats
  worth stating — Audit and INVESTIGATOR are founder-only by identity rather
  than capability, and Quoter is an outbound third-party link outside the access
  model; PWA install and the `/portal` + `/auth` caching exclusion; and a closing
  note that this identity never sends on its own authority.
- **No change** to source, authentication, membership, capabilities, roles, D1,
  R2, or the Cloudflare Access policy. Nothing was deployed. No secret value
  appears in the message.

### 18a. Correction and resend, same day

The founder reported not receiving the message. Two separate facts came out of
checking, and only one of them was a delivery problem.

- **It was delivered.** Inkbox status on `41a4a7bd-…` moved `sent` →
  `delivered` one second after the send; the sending domain `inkboxmail.com`
  is platform-verified and no bounce or domain warning was recorded. Gmail
  accepted it. `out-reach@inkboxmail.com` is a cold sender to that inbox, so
  Spam or the Promotions tab is the expected landing place — the address is
  worth allow-listing before any further sends to it are judged missing.
- **The HTML body was malformed, and it was the sender's error.** The first
  send wrapped the HTML in a `<![CDATA[ … ]]>` marker, which is XML syntax with
  no meaning in an email body; it was transmitted as literal body text, so the
  stored body began with `<![CDATA[`. The plain-text alternative was unaffected.
- **Resent clean:** Inkbox message id `f47be1f7-32fd-4e05-baae-296b95097b43`,
  thread `73b631a6-691e-4b88-bf53-ce02dd519e04`, status `delivered`, with
  `reply_to` set to `out-reach@inkboxmail.com`. Same recipient, same subject,
  same content; the body now begins at the opening `<div>`. Both sends went to
  `btcmao518@gmail.com` — the address was correct in both.

The rule this leaves behind: an email body is HTML, not XML. Never wrap it in a
CDATA section, and check a send's stored `body_html` rather than trusting that
a `sent` status means the message rendered.

## 19. Outbound send — morning brief to all active members

Sent 2026-08-17 on the owner's explicit order ("send a morning brief in detail
to ALL members including me. Stating what was improved"). Recorded because an
outbound send that is not in the record does not exist.

- **From:** `out-reach@inkboxmail.com` — the platform identity (Mr.T), sent
  through Inkbox. `reply_to` set to the desk. Open tracking off.
- **To:** every active member on the roster (§5), one individual send each so
  delivery status is per-recipient and the greeting is personal. The retired
  `bankerrunners@gmail.com` row was skipped — Google-locked, the inbox is dead.

| Recipient | Inkbox message id | Status at send-time check |
| --- | --- | --- |
| `btcmao518@gmail.com` (Shawn) | `6c298a89-7512-44a8-a797-8a3135c3d800` | `delivered`; stored `body_html` verified to begin at the opening `<div>` (§18a rule) |
| `ryandavidson.zenith@gmail.com` (Ryan Davidson) | `a4ad883c-74fc-4004-a202-6cc39ab81c31` | `sent` |
| `epiclife.nguyen@gmail.com` (Nate Nguyen) | `635fa64f-8a98-462f-bf36-e7a8f125ac26` | `sent` |
| `andrew.davidson.zenith@gmail.com` (Andrew Davidson) | `1497e7ec-1605-4a88-a8dd-3ac01dce24a8` | `sent` |

- **Subject:** `CORE / THRIVE — Morning Brief, August 17, 2026`. Identical
  body for all four recipients apart from the greeting name.
- **Contents, all drawn from this record and the merged PR trail:** the
  2026-08-16 Cloudflare Access edge lock and the three fail-closed layers; the
  founder identity migration to `btcmao518@gmail.com` (A9), stated without any
  secret value; the command prompt + portal chrome deploy (PR #36) and the
  Tournament 3 Field Console merge (PR #39); the public-page dark-theme
  overlay fix (PR #37, serving version `7427f4f4`); the Tier 1 hardening batch
  (PR #40: D5-1 rebuild lockout, A8-5 audit action truthfulness, T4-1 inverse
  guard net, A8-1 founder-set pin) with the suite at 58/58; Inkbox key hygiene
  closed (B19/10d) and the old-account trigger stand-down (§ of PR #42). A
  closing note restates that the desk sends only on the founder's explicit
  order and that replies are drafted, never acted on autonomously.
- **What the brief deliberately omits:** member roster details beyond what
  each member already is (no other members' emails appear in anyone's copy —
  each send is single-recipient), the nine caption-only routine briefs and
  other open gaps (internal, founder-facing, not member-facing), and all
  secret names and values.
- **No change** to source, authentication, membership, capabilities, roles,
  D1, R2, or the Cloudflare Access policy. Nothing was deployed.

### 19a. Outbound send — coffee reminder text to the founder, same day

Owner's order from the HQ session ("Reach out to Shawn on text msg to remind
him to make a coffee"). Sent over the Founder Channel iMessage conversation
(the owner's verified +1 409 549 2092, conversation `3cb144a0-…`), message id
`c80b6841-14b2-4fc0-8a94-2a77c518d4f3`, from the desk's own line. Plain SMS
was preflighted first and is blocked `recipient_not_opted_in` — the owner's
number has inbound consent as a recognized sender but no outbound SMS opt-in;
iMessage on the active assignment is the working outbound text channel to the
founder until that changes. The message also pointed him at the §19 morning
brief email and the Spam/Promotions caveat.

### 19b. Attempted good-morning texts to Ryan and Andre — blocked; email copy to the founder

Owner's order, same session ("Send a good morning text to these two as well
(friendly_playful), send Shawn copy of these 2 on email"), giving the numbers
Ryan Davidson **+1 941 210 1410** and Andre **+1 941 210 1411** (the owner
wrote "Andre"; presumed Andrew Davidson but not confirmed — the numbers are
recorded exactly as given).

- **Neither text was delivered.** Both channels are platform-blocked for
  both numbers: SMS preflight returns `recipient_not_opted_in`, and iMessage
  returns `imessage_no_assignment` — Inkbox requires each recipient to text
  "connect @out-reach" to the iMessage router (+1 650 484 9720) before the
  desk can message them, which is how the Founder Channel itself was opened.
  No workaround was attempted; the block is the consent model working.
- **The two drafts** (friendly/playful register, desk identified as AI,
  sent-on-Shawn's-order stated, pointer to the §19 brief email) were emailed
  verbatim to the founder with delivery status marked NOT DELIVERED and both
  unblock paths spelled out: Inkbox message id
  `d7595ad5-a6b7-40e6-82de-6a301dfee87a`, to `btcmao518@gmail.com`, status
  `sent`.
- **Standing state:** the texts go out as written the moment a recipient's
  channel opens and the founder says the word. Until an opt-in exists, the
  desk has no outbound text path to any member except the founder's own
  iMessage thread.

**Correction, same day:** the founder confirmed "Andre" was a typo for
**Andrew Davidson** — +1 941 210 1411 is Andrew's number, as presumed above.
His pending draft now greets him as Andrew.

### 19c. Good-mornings delivered by email; text channels still closed

Owner's order ("Send both"), same session. The iMessage sends were retried
first and both still return `imessage_no_assignment` — neither recipient has
connected. The two greetings therefore went out by email, content as drafted
(Andrew's greeting corrected per the 19b correction), each including the
connect instructions ("connect @out-reach" to the iMessage router) so the
text channel can open for next time.

| Recipient | Inkbox message id | Status |
| --- | --- | --- |
| `ryandavidson.zenith@gmail.com` | `ad0e246e-b5d9-4f64-ba72-0daaca69900d` | `sent` |
| `andrew.davidson.zenith@gmail.com` | `8a24281c-2830-475d-9c54-d301ebf885a7` | `sent` |

### 19d. A14 — text auto-reply granted for three verified numbers

**Numbering note:** this decision was drafted as A13 while a parallel
session was independently granting A13 to Andrew's Command Center access.
Main's A13 stands; this one is A14. The live routine still carries the
name "DESK TEXT AUTO-REPLY (A13)" in the trigger registry until renamed.

The founder asked how he gets a text back, was told auto-reply is a leash
change only he can make, and granted it: "the desk may auto-reply to my
verified number only: Ryan Shawn Andrew." Scope as recorded in
OWNER-DECISIONS.md A14: reply content only, three numbers only (Shawn
+1 409 549 2092, Ryan +1 941 210 1410, Andrew +1 941 210 1411), every other
sender stays log-and-draft, all content leashes unchanged. Implemented as
the hourly routine `DESK TEXT AUTO-REPLY (A14)`
(`trig_019FZZts1LhN9KayiwG9Q7rE`, fires at :41) carrying the complete
standing order as its prompt — deliberately not caption-only, so a woken
session has its brief and its leashes. HERALD itself is untouched and still
never sends.

**Honest limit at creation:** the trigger API refused the Inkbox connector
attachment from this session, so until the founder attaches Inkbox to the
routine in the claude.ai Routines UI, each firing wakes toolless and stops
by its own instruction. Reply latency once live is up to one hour (cron
minimum), not instant; instant replies remain a session-order away.

### 19e. Setup-instructions email to all four founders

Owner's order, same session ("email All founders clear instructions to
activate the app on Safari to the home screen and the instruction to allow
the text to go through"). One individual send per founder, identical body
apart from the greeting; no member sees another's address.

| Recipient | Inkbox message id | Status |
| --- | --- | --- |
| `btcmao518@gmail.com` (Shawn) | `0f66f3e7-e9fb-4c83-9acd-620efac957e8` | `sent` |
| `ryandavidson.zenith@gmail.com` (Ryan) | `f2303e4f-e8b8-4b52-9134-dbee8dca2c01` | `sent` |
| `epiclife.nguyen@gmail.com` (Nate) | `24bb2533-c6ac-436a-9565-f0662bbf319f` | `sent` |
| `andrew.davidson.zenith@gmail.com` (Andrew) | `2cdd2edb-983d-4ed5-9e75-8d66b2d4e1ba` | `sent` |

Contents: (1) iPhone/Safari home-screen install — the live URL, both gates
named in order, the §9 trap #9 rule stated as an instruction (copy the
six-digit Access code, never tap the emailed link), and the §10c warning
that the installed PWA has its own cookie container so both gates repeat
once inside the icon; (2) the two text-channel opt-in paths ("connect
@out-reach" to the iMessage router, or START to the desk's SMS line), with
the plain statement that the consent wall blocks all desk texts until one
is done. No secret value or name appears; nothing about founder-only
surfaces or other members' details is included.

Note: the A11 Google-IdP migration for Access, once the founder executes
it, retires the code emails — these instructions describe the wall as it
is today and will need a one-line update after A11 lands.

**A14 verification status (13:55Z):** the founder's live test ("Talk back
this is a test" + four more) was answered by the HQ session in real time
(message `1faa7803-…`, delivered and read; the founder confirmed receipt and
went for coffee). The manually-fired routine session sent nothing — either
correct stand-down (HQ's reply was already the latest outbound when it
checked) or a silent failure; indistinguishable from outside. The routine
path is therefore **not yet verified**. The founder's 13:50 reply is left
as the organic test case for the first scheduled pass at 14:41Z; a
self-check at 14:50Z records the outcome either way.

**A14 scheduled-pass verification FAILED (14:50Z).** The routine fired on
schedule (`last_fired_at` 2026-08-17T14:41:41Z) and sent nothing. The
founder's 13:50 message was still the newest message in the thread nine
minutes later; HQ answered it instead (`9aa558cb-…`). The routine path is
**not working**, and firing is not the problem — the woken session is.

Probable root cause, and it is not A13-specific: the trigger's stored
`session_context.allowed_tools` lists only built-in tools
(`preset:default`, Task, Bash, Read, Edit, …). No `mcp__Inkbox__*` entry
appears, even though the Inkbox connector IS attached to the trigger. A
fired session with no human present cannot clear a permission prompt for a
tool outside its allowlist, so the send never happens and the session ends
quietly. `update_trigger` exposes only name/cron/enabled/model/prompt — the
tool allowlist cannot be corrected from a session, so the fix is the
founder's, in the claude.ai Routines UI.

**Corroboration — a second routine is failing the same way, unnoticed:**
HERALD MORNING TEXT (`trig_01CRstytgH4Q3X2rEcTxy6zL`, the daily 8:30 AM
Central founder brief) fired today at 13:37:14Z and no morning-brief text
exists in the thread. Same environment, same connector, same allowlist
shape. The founder should assume the daily morning text has never actually
sent, rather than that a quiet night produced nothing.

Status: A14 remains **granted, armed, and unverified**; the HQ path is the
only proven way the desk texts anyone.

### 19f. Andrew's welcome + desk introduction

Owner's order ("send andrew along welcome mail top quality drafted with
artifact. He's on the site" / "send Andrew an introduction at msg
9412101411").

- **The text could not be sent.** +1 941 210 1411 is still blocked on both
  channels — SMS `recipient_not_opted_in`, iMessage `imessage_no_assignment`.
  Being signed in to the portal does not open a text channel; the phone-side
  connect step is separate and only Andrew can perform it. No workaround
  attempted.
- **Delivered by email instead**, carrying both the welcome and the
  introduction: Inkbox id `69ac7961-835e-44d0-bdb0-c216eccf287a`, to
  `andrew.davidson.zenith@gmail.com`, status `sent`. Contents: his roster row
  (owner, approved 2026-08-15, bound 2026-08-16), a link to the welcome
  artifact, the desk's self-introduction with the AI disclosure and the
  not-a-licensed-producer limit stated plainly, and both opt-in paths so the
  text channel can open.
- **Welcome artifact published:**
  `https://claude.ai/code/artifact/bb534d76-6017-4630-a463-f3c5cbfac704`
  ("Andrew's CORE Credential"). Content drawn from this record: the three
  access layers and fail-closed behaviour, the §10a sidebar surfaces with
  the Quoter-is-external seam stated, owner peer-protection, deny-by-default
  capabilities, and the iOS code-copy trap. Founder-only surfaces are not
  mentioned. No secret name or value appears; the page grants nothing.

**19f follow-up — Andrew's text channel is open.** He texted `START` to the
desk line (+1 689 689 1349) at 2026-08-18T03:51:45Z, which cleared the SMS
consent block. His introduction was sent immediately over SMS: Inkbox id
`12e03f72-535a-4668-a8da-48ebd4d87a45`, conversation
`5ce5a4bc-e920-4d68-870d-6304f70818d6`, status `queued`.

Two channel facts learned here, worth keeping:
- SMS opt-in is granted by ANY inbound message from the recipient; `START`
  is the conventional word but not a required one.
- iMessage has a second gate beyond the router connect: after
  `connect @out-reach` the assignment exists but the desk still cannot speak
  first — `imessage_awaiting_inbound` until the recipient sends a message
  into that thread. Andrew's iMessage path reached that state and remains
  there; SMS is what carried the message.

Andrew is now the second number on the A14 allowlist with a live channel
(Shawn's iMessage being the first). Ryan +1 941 210 1410 remains blocked on
both channels — no opt-in of any kind yet.

### 19g. Roster corrections executed — 2026-08-18

Owner decisions A15, run by the founder against the remote D1 and verified by
query the same minute.

| Email | Name | Role | Status |
| --- | --- | --- | --- |
| `btcmao518@gmail.com` | Yuxiang Mao (Shawn) | owner | active |
| `ryandavidson.zenith@gmail.com` | Ryan Davidson | owner | active |
| `andrew.davidson.zenith@gmail.com` | Andrew Davidson | owner | active |
| `bankerrunners@gmail.com` | Yuxiang Mao (Shawn) — retired identity | owner | **revoked** |
| `epiclife.nguyen@gmail.com` | Nate Nguyen — declined to invest | owner | **revoked** |

The roster is now three people, not five rows pretending to be five people.
Two things worth keeping from how this went:

- **The duplicate founder was a data defect, not a rendering one.** Both of
  his identities were stored `active` although Google locked the retired one
  on 2026-08-17, so every surface filtering on `status = 'active'` correctly
  showed him twice. Marking it revoked is not cosmetic — it makes the stored
  state match the fact that the address can never sign in again.
- **No row was deleted.** `access.ts` refuses any non-active row, so a revoked
  row grants nothing while remaining readable. Section 5 keeps the rule: the
  roster is the account of who held access and when, and a deleted row erases
  that account.

**Still open after this entry:** the `audit_events` inserts from
`db/sql/0004_roster_2026_08_18.sql` (the founder used two `--command` UPDATEs
rather than the file, so the status changes are live but unlogged — running
the file closes it, and the UPDATEs no-op), and Nate's removal from the
Cloudflare Access allow policy. Until that policy edit, his address still
clears the edge gate and is stopped only by the membership check: correct
behaviour, but he should not be reaching the gate at all. Outreach to him
ends here.

### 19h. Nate reinstated as an employee — A16 amends A15 the same day

The owner revoked Nate's owner row on the morning of 2026-08-18 because he
declined to invest, then clarified hours later: "He's my employee, leave him
the access." Both are true and they are not in conflict — **investing and
working here are different things**, and the role system exists to carry
exactly that difference. He becomes a **manager**, active.

Why this state rather than the obvious alternatives:

- **Not left revoked-with-Access.** Revoked in the roster while still on the
  Cloudflare Access allow policy would let him clear the edge gate and then be
  refused inside at `/portal/no-access`. That is a locked door behind an
  unlocked one — technically correct, and a bad thing to do to an employee.
- **Not restored as owner.** Ownership was the thing he declined. Putting the
  owner row back would make the roster claim an investment relationship that
  does not exist, and would hand him `members.manage` — the ability to change
  other people's access — for a role he no longer holds.
- **Manager** is the honest fit: he can see the roster (`members.view`) and
  never change it, review calls, and see team and leadership surfaces. He
  cannot manage members or edit approved call language.

**Withdrawn:** the A15 follow-up to remove him from the Cloudflare Access
policy. He is staff and signs in normally, so the policy keeps all four
addresses and no Access edit is needed.

The audit trail records the reinstatement as its own event rather than
overwriting the revocation. Both decisions happened, in that order, on one
day, and the record of access should show that rather than a tidy fiction in
which only the final state ever existed.

**Executed and verified 2026-08-18.** The roster now reads:

| Email | Name | Role | Status |
| --- | --- | --- | --- |
| `btcmao518@gmail.com` | Yuxiang Mao (Shawn) | owner | active |
| `ryandavidson.zenith@gmail.com` | Ryan Davidson | owner | active |
| `andrew.davidson.zenith@gmail.com` | Andrew Davidson | owner | active |
| `epiclife.nguyen@gmail.com` | Nate Nguyen | **manager** | active |
| `bankerrunners@gmail.com` | Yuxiang Mao (Shawn) — retired identity | owner | revoked |

Four people hold access; one retired identity is retained and cannot sign in.
The Cloudflare Access allow policy keeps all four addresses and needed no
edit.

**Audit-log debt, carried deliberately so it is not forgotten.** Three access
decisions of 2026-08-18 were applied with `--command` UPDATEs rather than the
SQL files, so their `audit_events` rows may not exist: Nate's revocation, the
retired-identity marking, and Nate's reinstatement. The portal's premise is
that every allow and deny is written to an append-only table; a roster change
that is live but unlogged is exactly the gap that table exists to prevent.
Running `db/sql/0004` and `db/sql/0005` from a merged `main` closes it — every
UPDATE in them no-ops against rows already in the target state, so a late run
is safe and writes only the missing audit rows. Confirm what is actually
missing first:

```
npx wrangler d1 execute site-creator-d1 --remote --command="SELECT actor_email, action, reason, created_at FROM audit_events ORDER BY id DESC LIMIT 6;"
```

### 19i. A14 verified live — the desk answered on its own

**2026-08-18.** The auto-reply routine had fired since 2026-08-17 without
sending anything (§19d): it woke, could not reach the Inkbox tools, and ended
quietly. The founder corrected the routine's configuration on the morning of
the 18th.

The loop then closed with no session open:

| | |
| --- | --- |
| Founder texted | 2026-08-18T05:13Z — a Meet link, an attachment, and "1:00pm" |
| Routine fired | on its own schedule, unattended |
| Desk replied | 2026-08-18T07:34:58Z, Inkbox `c79cec0d-b872-4263-bcad-9e34720d0f8e`, delivered |

**The reply's content is the part worth recording.** It acknowledged the Meet
link and the time, then said plainly that the attachment had arrived as an
unlabeled file type it could not read, and asked what was needed from it —
rather than guessing at the contents or passing over the gap in silence. The
allowlist held, the content leashes held, and the agent reported its own
limitation while unattended. A leash that holds when nobody is watching is
the only kind that counts.

**Still unverified:** HERALD MORNING TEXT. It last fired 2026-08-17T13:37Z and
sent nothing; its next scheduled pass is 2026-08-18T13:32Z. Until an outbound
brief appears in the thread, the daily 8:30 text remains a routine that has
never delivered.

### 19j. SignalWire number-role update — 2026-08-20

The founder supplied the current phone-number roles for the Thrive Company
SignalWire space:

- `+12053515158` / +1 (205) 351-5158 — outbound dialer caller ID.
- `+12053515118` / +1 (205) 351-5118 — main customer-facing inbound and
  transfer line.

The non-secret CORE configuration, Command page, Inbound page, and recorded
SWML/roster plan now use those identifiers. The older +1 (205) 351-3647 entry
remains in D9/D10 as history and is superseded for the active plan by D11.

**Not yet claimed live:** SignalWire redirected the supplied number-management
URL to its sign-in screen in this session. Until an authorized user signs in,
the live number ownership, inbound Resource assignment, outbound caller-ID
permission, and deployed SWML cannot be inspected or changed. No test call was
placed.

The portal's previous Collab Dialer was also found to be non-operational: it
stored a project API token in browser local storage, checked a token endpoint,
and then simulated a call with a local timer without invoking a voice SDK. That
credential form and false live-call claim were removed. Browser dialing stays
held offline until a server-side, capability-scoped session broker and a real
SignalWire voice client are implemented and verified.

### 19k. SignalWire live inspection and server dialer build — 2026-08-20

This entry supersedes 19j's unverified console assumptions without rewriting
that earlier state.

**Live SignalWire state verified in the founder's signed-in Space.** The Space
is `thrive-company.signalwire.com`, the current Project is the one shown by the
Space dashboard, and the three owned lines are now labeled:

- `+12053515118` — **Thrive Life Main**, the public inbound line.
- `+12053513647` — **Thrive Life Dial Line**, the bridge identity used by the
  inbound queue when it rings the founder.
- `+12053515158` — **CORE Platform Line**, the caller ID reserved for calls
  initiated by the CORE website.

The live `thrive-life-queue` SWML resource was simplified to one approved
private destination, uses 3647 as its bridge `from` value, requires press 1,
and has no recording, voicemail, transcription, or AI answering. SignalWire
confirmed the resource deployment and update timestamp. Its browser
Click-to-Test frame ended at 00:00 without ringing the private mobile, so this
record does **not** call the external ring verified; a real inbound call to
5118 remains the proof.

**Credential correction.** The existing token named `Shawn` cannot be treated
as an unused dialer token: SignalWire showed recent use, and its edit page
showed every available permission enabled. It was not displayed, copied,
renamed, narrowed, deleted, or repurposed. The outbound portal requires a new
dedicated `CORE_DIALER` token with Voice permission only. A separate token
isolates revocation and audit identity but does not create separate carrier
throughput: SignalWire documents the default voice limit across the Space, so
the portal also reserves no more than one request per 30-second D1 bucket.

**Portal implementation state.** The working tree now contains a real
founder-only server originate route using SignalWire's outbound REST API with
inline SWML. The route rings the private mobile first, requires press 1 before
any customer leg, presents 5158 as the caller ID, blocks CORE-owned numbers as
customer destinations, keeps the project token server-side, stores only masked
destination metadata, and leaves recording off. A separate test mode rings
only the private mobile and never calls a customer. `outbound_dial_requests`
provides a durable request ledger and duplicate-call limiter.

**Not yet live at this entry:** the Voice-only token has not been created and
transferred into Sites secrets, the D1 migration has not been applied to the
hosted database, the source has not been published, and no portal-originated
test call has succeeded. Local implementation is not a deployment.
### 19l. Ten-agent durable memory and empty-response repair — 2026-08-20

The owner directed that all ten Operations Deck personalities receive a full
CORE memory update after Lumen twice accepted and persisted a request but
returned only: “I could not produce a useful response. No external action was
taken.” The runtime defect and the memory update were handled together in the
separate `core-agent-fleet` service; the production CORE portal Worker was not
changed.

**Source and deployment provenance.** The local service directory in the
isolated `codex/ten-agent-fleet` worktree was unexpectedly empty. The exact 33
source/config files used by the live build were recovered from the dated
`C:\Users\k2547\OneDrive\Desktop\FLEET` build snapshot and restored into
`services/core-agent-fleet`; every recovered file matched its source snapshot
by SHA-256 before editing. The worktree remained at
`eb54b0bfb726d06c5b9efffa8e79dbba57154eb1`. No Git stage, commit, push, PR, or
merge was performed, and `services/` remains untracked.

**Root cause and repair.** The fleet used the reasoning model
`@cf/zai-org/glm-4.7-flash` through `workers-ai-provider` with a 700-token
maximum. Reasoning is enabled by default for that model, so a call could
consume its budget without emitting final text; the prior adapter treated the
empty string as a successful ready turn. Fleet Worker `0.2.1` now:

- disables model reasoning/thinking for this draft-only surface;
- makes at most two bounded generation attempts;
- allows 2,800 final-output tokens with a 55-second call timeout;
- records safe empty-output observability without logging prompts;
- returns a truthful persona-specific failure only after both attempts; and
- marks repeated empty output `degraded` with `empty_model_output` instead of
  reporting a false ready state.

**Durable institutional memory.** Each agent now has an
`institutional_memory` SQLite record plus state fields for version and update
time. Memory version `core-2026-08-20.1` contains the shared CORE baseline and
one distinct role overlay. The baseline covers evidence-status rules,
J.A.R.V.I.S. identity and human authority, current portal/fleet boundaries,
the CORE operating loop and verified-signal concept, commission variables and
the corrected 39,200 residual calculation, prototype Levels 1–5, call and
policy-replacement safety limits, design direction, the owner keyword Narb,
and the ten-seat handoff contract. Proposed builder/equity and replacement
logic remain explicitly unverified rather than being invented as policy.

An authenticated, idempotent `POST /api/fleet` bridge now invokes the compiled
fleet bootstrap without exposing the Worker secret. The same memory version
was synchronized and read back from all ten Durable Objects. Final status
showed `10/10 ready`, Worker `0.2.1`, and memory
`core-2026-08-20.1` for Vestal, Recon, Terraform, Meridian, Lattice, Cipher,
Lumen, Index, Assay, and Ledger.

**Verification evidence.** Generated Worker types, Worker TypeScript,
9/9 Vitest checks, Wrangler dry-run, console TypeScript, ESLint, and the Next
production build all passed. Cloudflare deployment
`2f5f1ab7-ddd2-4f9d-b4c7-d8b85afe1bc3` is at 100%. Protected Vercel preview
deployment `dpl_BiWZqU8LfKp6keP6YzezEJEQ22D9` is ready at
`https://core-agent-fleet-console-g6xacm4i8-thrive18.vercel.app`.

The exact Lumen request from the failed console turn was replayed through that
protected preview. The final answer was 9,623 characters, contained all ten
named design briefs through Ledger, did not use the empty-output fallback, and
returned Lumen `ready`, Worker `0.2.1`, memory
`core-2026-08-20.1`, durable turn 5.

**Capability boundary retained.** Lumen can now reliably produce visual
concepts, complete generation briefs, and asset specifications. This Worker
still has zero external tools and did not render ten image files. Image
generation requires a separately connected and governed image tool; Inkbox
identity mapping still does not authorize outbound channel action.

### 19m. SKY fleet count corrected and ten-agent runtime connected — 2026-08-20

The owner reported that `https://skyisblue.space/fleet` showed one connected
identity despite the previously established ten-agent runtime and directed
the necessary updates to `main`.

**Root cause.** SKY's `/fleet` page was only an Inkbox identity registry. Its
single connected count meant that `@eye` was the only identity observed by
SKY's read-only Inkbox key; it did not inspect the separate Cloudflare
Durable Object runtime. The page therefore displayed a true Inkbox fact under
language that was too easy to interpret as the runtime-agent count.

**Repair.** SKY now calls the protected `core-agent-fleet` status endpoint
server-side with a dedicated secret and shows the two systems separately:

- runtime connected is the number of authenticated Durable Object status rows
  actually returned, with ready, working, and degraded shown independently;
- Inkbox reads remains one and provisioned Inkbox identities remains ten; and
- an unavailable Worker fails closed rather than displaying the expected ten
  as if they had been reached.

The Worker probe path was also repaired so a successful probe clears a stale
degraded state and stale error. Worker version `0.2.2` was uploaded in
Cloudflare code deployment `8b4634be-83f9-45dc-aa08-ba7d8592b731`; the final
secret-change deployment is `6b9bb41d-072e-4ca1-b3fe-d25575750353` at 100%.
The shared bearer secret was rotated and synchronized across Cloudflare, the
SKY Vercel project, and the protected fleet-console Vercel project. No secret
value was logged or committed.

**Verified runtime state.** An authenticated probe and follow-up status read
returned all ten personas — Vestal, Recon, Terraform, Meridian, Lattice,
Cipher, Lumen, Index, Assay, and Ledger — with `10 ready`, `0 working`, and
`0 degraded`. Every row reported Worker `0.2.2` and memory
`core-2026-08-20.1`. The public health endpoint independently reported
`agentCount: 10`, `version: 0.2.2`, and `tools: 0`.

**Source and deployment evidence.** The runtime service and durable record
were signed and pushed to canonical CORE `main` at
`d65d0189040916a13935b914d3918064f84bcc25`. SKY was signed and pushed to
`main` at `6c423bf5242e06c887a7f658eb052acbefa13313`. Its Vercel production
deployment `dpl_Bw2jcKEbr8fWQNwCPFBkfwdBpuns` is ready, aliases
`skyisblue.space`, and reports the exact same Git SHA and `main` ref. The
protected fleet-console preview
`dpl_G2MYTtAD6nWZpDBXXTEmaWS4FEL4` is also ready; its protected `/api/fleet`
returned the same 10/10 ready state.

**Verification gates.** SKY typecheck, lint, 110/110 tests, and the Next
production build passed. Fleet console typecheck, lint, and production build
passed. Worker generated types, strict TypeScript, 10/10 tests, and Wrangler
dry-run passed before deployment. The local UI could not bypass the real
Google session gate, so the authenticated page pixels were not independently
rendered in this session; production source, build, alias, exact commit, live
Worker response, and the protected console bridge were verified.

### 19n. Founder-only Personal Command built locally — 2026-08-20

The owner directed the Official App to turn the supplied portal references
and SKY benchmark into a stronger personal command surface. This work was
implemented in the canonical `C:\dev\core-platform-site` checkout on top of
`b1ae1ca2e852b8d2033240457eb28535d0611687`. The concurrently delivered SKY
and fleet-runtime work was preserved; it was not rewritten or attributed to
this change.

**Local implementation.** A new `/portal/command/personal` page provides a
founder-focused control surface with a command handoff, founder focus cards,
four operating lanes, the ten defined CORE fleet profiles, an explicit
authority boundary, and responsive desktop/mobile navigation. Its launchers
only hand off to existing protected CORE destinations; each destination keeps
its own server-side authorization. The shared `/portal/command` page exposes
the Personal Command launcher only when the current signed session is the
founder.

**Authorization and truth model.** The page guards itself with
`requireFounder("/portal/command/personal", "command.personal.view")`, is
force-dynamic, and is covered by no-store authorization tests. The retired
founder identity, second owner, and named Command helper are denied the route.
The ten fleet entries are labeled as defined AI roles rather than people or
continuous staff. No live mailbox or operational count is inferred, and the
surface adds no ability to send, dial, deploy, spend, approve, or alter an
external system.

**Reference handling.** The supplied HTML dashboards and screenshots were
used only as layout and product-direction references. Their Gmail addresses,
phone numbers, billing details, security notes, mailbox rows, and other
private snapshot data were not copied into the application. SKY informed the
clarity and command-center feel; this page remains an original CORE surface.

**Verification evidence.** The focused TypeScript check and focused ESLint
passed, the Next production build passed with the new route in its route
table, 91/91 targeted authorization and rendered-output tests passed, the
complete test command passed 120/120 tests, and `verify:build` produced a
valid Worker bundle. The repository-wide TypeScript command remains blocked
outside this page because the separately added `services/core-agent-fleet`
sources are included by the root TypeScript configuration while their `@/`
imports require that service's own alias mapping. The repository-wide lint
command also remains blocked by the pre-existing unescaped apostrophe in
`app/portal/quoter/quoter-tool.tsx` and generated/concurrent service output;
the files changed for Personal Command pass their focused lint gate.

**Delivery boundary.** This is verified local source only. No commit, push,
site version, deployment, migration, call, message, credential change,
membership change, or access-policy change was performed for Personal
Command. The current public production URL must not be described as containing
this page until an authorized deployment is completed and verified.

### 19o. Outbound dialer SWML warning repaired locally — 2026-08-20

The founder reported that the Collab Dialer still did not complete its private
mobile test. SignalWire's live call record showed that the outbound PSTN leg
was created, rang, and answered, but then generated a script warning and ended
after five seconds. This isolates the failure to post-answer call control: the
provider credential, caller ID, destination, and PSTN origination had already
succeeded.

**Root cause.** `buildAgentTestPlan()` and `buildCustomerPlan()` supplied
`prompt.play` as an array of `{ say: ... }` and `{ silence: ... }` objects.
SignalWire's current SWML `prompt` contract accepts a playable string or array
of playable strings, such as `say:...` and `silence:2`. The provider accepted
the outer Calling API request but rejected the invalid inline SWML when the
answered leg tried to execute it. The old unit tests asserted only that the
request contained the intended words and omitted recording; they did not pin
the provider's required prompt shape.

**Local repair.** A dialer-only branch from current `main` now:

- emits documented `prompt.play` string arrays;
- evaluates DTMF with a documented `switch` on `prompt_value`;
- fails closed when no `1` is received and states that the customer was not
  called;
- uses a direct `connect.to` for the single customer leg; and
- removes the unverified voice override so the provider's supported default
  voice is used.

No recording, transcription, AI participation, credential handling, caller-ID
selection, private-number storage, authorization, audit, or rate-limit rule was
changed.

**Verification.** The focused outbound suite passed 7/7, including exact
assertions that every prompt entry is a string and that only the `1` branch can
reach `connect`. Focused lint and whitespace checks passed. The production
build and the complete repository suite passed 120/120. The root TypeScript
command remains blocked only by the separately recorded
`services/core-agent-fleet` alias/dependency baseline; the changed dialer file
passes focused lint and is exercised by the production build.

**Delivery boundary.** This is a verified local fix on
`codex/dialer-swml-fix-20260820`, not a live repair. No merge, deployment,
migration, secret change, provider configuration change, or new call was
performed. The exact founder `mi` merge authorization remains required before
the branch can be merged; deployment and a controlled private-mobile test are
separate subsequent actions.
### 19p. Automatic inbound browser calling implementation staged — 2026-08-20

The founder approved a same-day inbound calling design for the five active
CORE accounts: personal business numbers, the existing Thrive Life main line,
8-second browser stages, the existing private-mobile fallback with telephone
DTMF `1`, final announced voicemail, a global Calls mode in the J.A.R.V.I.S.
eye, and one consolidated `/portal/calls` workspace.

**Repository boundary.** Work was isolated from the canonical worktree's
unrelated Personal Command changes in
`C:\dev\core-platform-inbound-calls`, branch
`codex/inbound-calls-20260820`. It originated at the required base
`b1ae1ca2e852b8d2033240457eb28535d0611687` and, after the founder supplied
the one-use merge keyword, was transplanted without Gallery history onto
current `main` at `662612070cee1f7125c4b7cfd377cbe40cbb1daa`. This entry
records a verified implementation artifact, not a live release. The keyword
authorizes the squash merge only. Deployment, D1 mutation, secret upload,
provider provisioning, purchasing, routing changes, and live calls each remain
separate production actions requiring their own explicit authorization and
verified gate evidence.

**Implemented locally.** The branch adds the five-table forward-only D1 voice
migration, the authenticated bootstrap/session/presence/offer/team-return/task
interfaces, Basic-plus-HMAC SignalWire lifecycle/routing/voicemail callbacks,
masked and optionally AES-GCM-encrypted caller storage, exact provider
Subscriber ID/address validation, atomic first-answer-wins offers, two-phase
Send to Team, final-voicemail-only recording into protected R2, and
exactly-once callback tasks. The floating eye now has J.A.R.V.I.S. and Calls
modes; employees must explicitly become Available; only one primary tab
registers; keyboard `1` is scoped to an incoming offer; the THRIVE Radio pauses
for a call and does not resume itself. The expanded Account Balance control now
has a Calls launcher and honest phone-state indicator immediately beneath it in
the sticky top bar, keeping the browser phone reachable throughout the portal.
`/portal/inbound` redirects to the Live tab. The three former call destinations
are now one: Call Lab stays within Calls, the founder-only Collab Dialer is the
Outbound tab, and `/portal/dialer` preserves old founder bookmarks by
redirecting to that tab. The sidebar exposes only the single Calls destination;
the outbound server action remains founder-only and employees receive neither
the tab nor the dialer surface.

**Verified local evidence.** Production build passed. The full suite passed
122/122, including a production-shaped Miniflare call flow that exercises
personal and shared hunts, stale/unavailable exclusion, simultaneous answer
races, provider-confirmed team return, mobile and voicemail progression,
callback idempotency/claim/playback, self-versus-founder visibility,
Subscriber-token denial, opaque Basic/HMAC failures, caller encryption and
masking, and D1 uniqueness. Task-owned ESLint and TypeScript checks passed;
build preflight passed; built client assets contained none of the scanned
SignalWire secret names, private Space hostname, dummy token values, private
mobile marker, or encryption-key name.

**Still pending and not claimed.** No production migration ran. No secret was
uploaded. No Subscriber or personal DID was created or purchased. The live
checkout total was not displayed or reverified, so the $20/month fixed-cost
gate has not been satisfied. No Cloudflare Access bypass was added for the new
exact machine paths. No personal number or `+12053515118` routing changed. No
browser audio, mobile fallback, voicemail, callback task, or rollback was
smoke-tested against production. The implementation and post-gate sequence are
recorded without secret values in `INBOUND_CALLING_RELEASE.md`.

**Release order retained.** Use `mi` to merge the verified branch into current
`main`, then rerun the full gates on the merged revision. After separate
production authorization: apply the additive D1 migration, upload server-only
secrets, create/fetch Subscribers and their provider-returned exact audio
addresses, recheck checkout and stop above the $20 fixed ceiling, purchase and
deterministically assign five numbers, test personal DIDs first, then change
and test the shared main line. Rollback is configuration-first to the existing
private-mobile route; the schema stays dormant and numbers are retained unless
separately authorized for release.

### 19q. Browser-phone registration failure isolated and repaired locally — 2026-08-20

The founder reported that microphone access was enabled but the floating Calls
panel remained indefinitely at **Registering**. Live inspection separated the
layers before changing code: browser microphone acquisition succeeded, the
active member had the protected 3647 assignment, and—after the Worker team-hunt
configuration was corrected to the approved public-address form—the
authenticated session and bootstrap endpoints both returned 200. No call was
placed and the 5118 route was not changed.

**Root cause.** The client constructed `@signalwire/js@4.0.0-rc.2` and read
`client.session.incomingCalls$` before the deferred SignalWire connection had
opened and authenticated the session. That setup exception entered cleanup,
where `client.destroy()` could throw again against the partially initialized
SDK client. The second exception interrupted the UI error transition and left
the panel displaying **Registering**, which made a post-permission SDK failure
look like a microphone problem.

**Local repair.** Isolated branch
`codex/browser-phone-registration-20260820`, based on
`main@cd96e872ad13106cf394746d4a9c808dedfc2b67`, now defers both connection and
registration, explicitly awaits `connect()`, subscribes to incoming calls only
after the authenticated session exists, and then calls `register()`. Subscription
cleanup is installed before connection begins, and destruction of a partially
initialized client is non-throwing so the panel can always leave Registering
and show an honest retryable error. The Outbound tab's stale setup sentence was
also corrected: it now describes the dedicated server-only Voice credential as
the active boundary instead of claiming that creating it is still pending.

**Verification.** Focused ESLint passed. The production build passed; the full
suite passed 124/124, including a new source-ordering and cleanup regression.
`verify:build` passed against the production D1 and R2 bindings. The built
client contained none of the scanned Voice secret names, subscriber-token test
fixture, private Space hostname, or encryption-key marker. Repository-wide
TypeScript remains blocked only by the already-recorded, unrelated
`services/core-agent-fleet` alias/dependency baseline; the production build and
task-owned checks compile the phone change successfully.

**Delivery boundary.** This is a verified local repair, not yet production.
The canonical checkout's unrelated Gallery work was not touched or absorbed.
No merge, deployment, provider routing change, number purchase, token
revocation, or test call was performed. The exact one-use founder keyword `mi`
is still required for this branch's merge; deployment remains a separate
authorized action after the merged-main gates pass.

### 19r. Browser-phone registration repair deployed - 2026-08-20

The founder separately authorized production deployment after PR #114 was
squash-merged. The release ran from the clean isolated worktree at exact merged
`main@38606f86c2825cb758f563246ba96aa349fa775a`; the canonical checkout's
unrelated Gallery edits were not included or altered.

The repository-required `npm run deploy` chain rebuilt the Worker, passed the
complete 124/124 test suite, passed `verify:build`, and deployed Worker version
`9147c300-97dc-44dc-a3cf-154636207ae4` at 100% to
`https://site-creator-vinext-starter.thrive18.workers.dev`. The deploy reported
the intended `site-creator-d1` binding, the `site-creator-r2` recording bucket,
and a 22 ms Worker startup time. A post-deploy deployment-list read confirmed
the new version at 100%; the immediately preceding version retained for
rollback is `e4433197-df69-4b7c-a406-0fd2e7b396e3`.

Post-deploy anonymous probes returned 200 for the public root and 307 sign-in
redirects for both `/portal` and `/portal/calls`, preserving the application
access boundary. Existing Google, session, outbound-dialer, and browser-phone
secret names remained present in Cloudflare without displaying their values.
No D1 mutation, secret update, SignalWire routing change, number purchase,
number release, or live/test call occurred as part of this deployment.

This entry is a local documentation follow-up on
`codex/deploy-log-browser-phone-20260820`; it is not yet merged. A fresh
one-use founder `mi` is required to merge the record update.

### 19s. Post-deployment SDK user-initialization race repaired locally - 2026-08-20

After the deployment recorded above, the founder retried **Available** on the
production Calls panel. The account and protected 3647 assignment loaded, but
the panel returned Offline with the exact SDK error **Unexpected Error at Error
fetching user information**. The screenshot established that this was no
longer the prior indefinite Registering state and no longer a microphone-
permission failure.

**Root cause.** With `skipConnection: true`, `@signalwire/js@4.0.0-rc.2`
returns its client from the constructor before its asynchronous credential
resolution and `User` initialization have completed. CORE immediately called
`client.connect()`. The SDK therefore raced its own `user$` initialization and
wrapped the missing/not-yet-fetched user as **Error fetching user
information**.

**Local repair.** Clean isolated branch
`codex/browser-phone-init-race-20260820`, based on exact deployed
`main@38606f86c2825cb758f563246ba96aa349fa775a`, now waits on the SDK's public
`user$` readiness signal before calling `connect()`. The gate listens to the
SDK error stream and has a ten-second timeout so credential or initialization
failures become an honest retryable error instead of an unbounded wait. The
existing order remains: user ready, connect, subscribe to incoming calls, then
register.

**Verification.** Focused inbound tests passed 4/4. Focused ESLint and the
production build passed. The complete repository suite passed 124/124 and
`verify:build` passed. The built client contains the new readiness guard and
none of the scanned server-only Voice configuration names. Repository-wide
TypeScript remains blocked only by the already-recorded, unrelated
`services/core-agent-fleet` alias/dependency baseline; the production build
compiled the changed browser phone successfully.

**Delivery boundary.** This is a verified local repair, not a live fix yet.
No provider resource, D1 row, Worker secret, number route, 5118 behavior, or
call was changed. The exact one-use founder keyword `mi` is required before
this branch can merge; production deployment remains a separate explicit
action after merged-main verification.

### 19t. Post-deployment availability heartbeat repaired locally — 2026-08-20

The SignalWire user-initialization repair recorded in 19s was subsequently
squash-merged and deployed as
`main@06988d2e31d49e3a740a00cdf043d6e947826a38`, Worker version
`b9ca5dc3-9f75-425e-8e09-5e31e4cbe20a`. After that deployment, the founder's
browser reached **Available** on the protected 3647 assignment, but a provider
test still announced that nobody was available.

**Production evidence and root cause.** A read-only D1 inspection after the
founder's hard restart showed member 8 authorized as Available at
`2026-08-20T19:47:01.087Z`, with that same value as the only heartbeat and an
expiry of `2026-08-20T19:47:46.087Z`. At `2026-08-20 19:48:05` the row was
already ineligible while the browser still displayed Available. The client
heartbeat effect had executed before the primary-tab lock existed, returned,
and never reran: the lock lived only in a ref, whose later mutation does not
rerender React. A second server defect allowed an already expired tab to renew
itself if a delayed heartbeat eventually arrived. The same read-only check
found no inbound call, call offer, or `calls.route` audit row from the provider
test, so that test is not evidence that the authenticated CORE route ran.

**Local repair.** Isolated branch
`codex/browser-phone-heartbeat-20260820`, based on exact deployed
`origin/main@06988d2e31d49e3a740a00cdf043d6e947826a38`, now activates the
15-second heartbeat from the reactive phone-eligible state after Available is
persisted. Successful acknowledgements advance the tracked D1 expiry, and a
client watchdog takes the phone Offline if that eligibility is not renewed.
The server refuses a heartbeat after expiry, preventing a stale or throttled
tab from silently re-entering the hunt without a fresh registration.

**Verification.** The regression failed on the prior source in both expected
places: the client effect was not reactive and an expired heartbeat returned
200 instead of 409. After the repair, the focused production-shaped Miniflare
and client-lifecycle checks passed 2/2. The production build and complete suite
passed 125/125; `verify:build` reported the Worker safe to deploy. Task-owned
ESLint and TypeScript checks passed, `git diff --check` passed, and the built
client contained the expiry guard without any scanned Voice credential name,
subscriber-token fixture, private Space hostname, or encryption-key marker.
Repository-wide TypeScript and lint remain blocked only by the separately
recorded fleet alias/dependency baseline and the existing Quoter apostrophe.

**Delivery boundary.** This is a verified local repair, not production. No D1
row was mutated, no secret or provider resource changed, neither 3647 nor 5118
routing changed, and no call was placed. A fresh one-use founder `mi` is
required to merge this branch. Deployment remains a separate explicit action
after the merged-main gates pass; an authenticated heartbeat observation and
controlled 3647 route test remain post-deploy acceptance checks.

### 19u. Inbound browser-answer context failure repaired locally — 2026-08-20

The availability-heartbeat repair was subsequently squash-merged and deployed
as `main@185c9b6fafdcd7ef0e05efc5237e24b8aa1120e9`, Worker version
`f1173dd7-d590-4ff8-a8fd-d388e50ade53`. A founder-controlled 3647 test then
provided the first direct production evidence that the repaired presence path
reached the browser: the floating Calls panel opened with an eight-second team
hunt and exposed the Answer control. After Answer was selected, however, the
panel stayed at **Claiming the call…**, the browser leg closed, and no two-way
audio was established.

**Root cause.** CORE had appended its parent call ID, stage, attempt, masked
line, and masked caller metadata as query parameters on each SignalWire Fabric
Subscriber Resource Address. SignalWire used the address to deliver the invite
but did not preserve those application query parameters on the Browser SDK
`Call`. All three visible fallbacks in the founder's evidence confirmed the
loss: **AVAILABLE-TEAM HUNT**, **Called THRIVE line**, and **Caller number
unavailable**. The client consequently tried to authorize the connected child
browser leg with its SDK call ID and a fabricated default team context instead
of the canonical parent D1 offer. The authenticated answer endpoint rejected
that mismatch and the client correctly closed the leg, but its disconnect
handler then overwrote the useful failure state with Available.

**Local repair.** Clean isolated branch
`codex/browser-inbound-answer-context-20260820`, based on exact deployed
`main@185c9b6fafdcd7ef0e05efc5237e24b8aa1120e9`, now sends SignalWire the exact
provider-issued Subscriber Resource Address without application metadata. On
an incoming invite, the authenticated primary browser session asks CORE to
resolve its newest active D1 offer. The server verifies the member's active
assignment, exact unexpired Available browser session, active call, intended
offer, stage, and attempt before returning only the canonical parent call ID
and already-masked display values. An invite whose context cannot be resolved
is rejected; Answer is never enabled for it. The connected event therefore
claims the real D1 offer, and a claim-authorization failure remains visible
after the provider closes the leg instead of being silently replaced by
Available.

**Verification.** The production-shaped Miniflare suite now covers resolution,
wrong-browser refusal, exact Subscriber addresses, masked display context, a
resolved browser answer, accepted-member ownership, connected status, call end,
and return to Available. Focused inbound tests passed 6/6. The production build
and complete repository suite passed 126/126; focused ESLint, `verify:build`,
and `git diff --check` passed. The built client
contained none of the scanned Voice credential, mobile-fallback,
caller-encryption, machine-auth, or token-fixture markers. Repository-wide
TypeScript emitted no diagnostic for a task-owned file and remains blocked only
by the already-recorded, unrelated `services/core-agent-fleet`
alias/dependency baseline.

**Delivery boundary.** This is a verified local repair, not a live fix. The
canonical checkout's unrelated Gallery work was not touched or absorbed. No
D1 row, Worker secret, provider resource, Subscriber, number assignment, or
routing rule was changed; neither 3647 nor 5118 was rerouted, and no call was
placed. A fresh one-use founder `mi` is required to merge this branch.
Deployment remains a separate explicit action after merged-main verification,
followed by one controlled 3647 browser-answer smoke test.

### 19v. SignalWire SWML webhook signature encoding repaired locally — 2026-08-20

After the founder reset the browser to one primary CORE tab and returned the
protected 3647 assignment to **Available**, a read-only production inspection
confirmed member 8 had a live heartbeat and was hunt-eligible. The preceding
provider test had reached `/portal/calls/route` sixteen times, and every request
matched the current HTTP Basic secret but was denied as `bad_signature`. No
CORE inbound-call row, browser offer, voicemail callback task, or successful
route audit was created, so the provider-side fallback was reached before CORE
could return its browser hunt.

**Root cause.** SignalWire's documented SWML/JSON scheme sends lowercase
hexadecimal HMAC-SHA1 over the exact configured public URL plus the exact raw
JSON body. CORE instead rendered its HMAC-SHA1 as base64 and also accepted an
undocumented base64 SHA-256 alternative. A valid forty-character provider
signature therefore could not equal CORE's twenty-eight-character base64
value, even with the correct signing key, URL, and request body. The separate
Compatibility form scheme remains HMAC-SHA1 rendered as base64 over sorted
form fields, including repeated values in submission order.

**Local repair.** Clean isolated branch
`codex/signalwire-signature-hex-20260820`, based on exact
`origin/main@c5d33a31699c0a9e88d6232c1702af2472edb19a`, now selects one typed
signature scheme from the request content type. SWML/JSON verifies lowercase
hexadecimal HMAC-SHA1 over the configured URL and untouched raw body;
Compatibility form callbacks verify base64 HMAC-SHA1 over their documented
sorted field construction. The current/previous Basic-secret rotation,
configured-origin boundary, literal path check, constant-time comparison,
opaque external denial, and fail-closed audit requirement remain intact. The
speculative SHA-256/base64 acceptance was removed.

**Verification.** SignalWire's official SWML signature vector is pinned in the
regression suite. Focused authentication and inbound-browser checks passed
19/19. The production build passed, the complete repository suite passed
128/128, and `verify:build` reported the Worker safe to deploy with the
intended D1 binding and seventeen client assets. Task-owned ESLint and
`git diff --check` passed. The built client contained none of the scanned Voice
secret names or signing-key fixtures. Repository-wide lint remains blocked
only by the existing unrelated Quoter apostrophe plus five fleet warnings.

**Delivery boundary.** This is a verified local repair, not production. The
canonical checkout's unrelated Gallery work was not touched or absorbed. No
D1 row, Worker secret, provider resource, Subscriber, number assignment, or
routing rule was changed; neither 3647 nor 5118 was rerouted, and no call was
placed. A fresh one-use founder `mi` is required to merge this branch.
Deployment remains a separate explicit action after merged-main verification,
followed by one separately confirmed controlled 3647 browser call.

### 19w. SignalWire External SWML call-context parser repaired locally — 2026-08-20

After the signature repair in 19v was squash-merged and deployed as
`main@21ce3fa2f8a8ba6971bd76215261c0240518714f`, the founder explicitly
authorized one controlled 3647 browser test. The SignalWire Dashboard
Click-to-Test action created Voice Segment
`073d4803-1b93-4ac2-a370-d5209b217a9a`, reached CORE, and ended after one
second when `/portal/calls/route` returned HTTP 503. CORE never created an
inbound-call or browser-offer row, so the browser correctly remained
Available. SignalWire retried the document fetch four times; CORE did not
submit a second test.

**What the test proved.** Production audit rows 29486–29489 independently
verified both machine-authentication factors and recorded
`secret_and_signature_verified` with the documented SWML JSON SHA-1 hex
scheme. The reset signing key and the 19v signature repair therefore worked.
The Dashboard test targeted a Call Fabric `/public/...` resource rather than
placing a PSTN call to the 3647 DID; it proved the authenticated document-fetch
path, not the number's public telephone routing.

**Root cause.** SignalWire's current External Calling SWML webhook nests the
provider identifier at `call.call_id`. The deployed normalizer accepted only
the legacy `call.id`, a root `call_id`, or an internal variable, so the
authentic request failed normalization before any D1 insert. The same official
contract exposes phone-specific values as `call.from_number` and
`call.to_number`, and identifies a connect- or transfer-created parent at
`call.parent.call_id`. The prior production-shaped test fixture incorrectly
used `call.id`, allowing the contract mismatch to pass locally.

**Local repair.** Clean isolated branch
`codex/signalwire-call-id-20260820`, based on exact
`origin/main@21ce3fa2f8a8ba6971bd76215261c0240518714f`, now prefers the
documented nested call ID, phone-number fields, and parent call ID while
retaining the former shapes only as compatibility fallbacks. The regression
fixture now uses the provider's real envelope. A missing provider ID fails
closed before writing a call, and a browser-only `/public/...` Click-to-Test
address is explicitly refused as a DID so it cannot be misrepresented as a
3647 PSTN routing test.

**Verification.** The focused inbound-browser suite passed 7/7. The production
build and complete repository suite passed 128/128. `verify:build` reported the
Worker safe to deploy with the intended D1 binding and seventeen client
assets. Task-owned ESLint, `git diff --check`, and a diff scan for embedded
HTTP user-info credentials passed. Repository-wide TypeScript remains blocked
only by the already-recorded, unrelated `services/core-agent-fleet`
alias/dependency baseline; no diagnostic names a task-owned file. An
independent review checked the patch against SignalWire's current first-party
inbound-call schema.

**Delivery boundary.** This is a verified local repair, not production. The
canonical checkout's unrelated Gallery work was not touched or absorbed. No
D1 row, Worker secret, provider resource, Subscriber, number assignment, or
routing rule was changed; 5118 was untouched. The one Dashboard test described
above is the only call action in this repair. A fresh one-use founder `mi` is
required to merge the branch. Deployment is a separate explicit action after
merged-main verification, and a real 3647 PSTN browser-answer test requires a
new action-time confirmation after deployment.

### 19x. Call-context parser fix deployed to production — 2026-08-21

The 19w repair reached production. The branch merged to main as `1724c9c`
(PR #118, "fix(calls): accept SignalWire call context") and the Worker
deployed tonight: version `f25e66aa-95ea-4d6a-b1c4-8d2e03a7c519`, created
2026-08-21T01:21:23Z.

**Version id provenance.** The work order carried only the id prefix, and
the recording session had no Cloudflare credentials to run
`npx wrangler deployments list` itself. Honoring the standing rule (§18,
and the two ids already lost to scrollback in the 2026-08-17 deploy log),
the entry was held in draft until the founder recovered the full id from
Cloudflare and supplied it at action time on 2026-08-21; it matched the
work order's prefix and is recorded here and in the DEPLOYMENT.md deploy
log.

**What is and is not established.** Established from the repository: main
is at `1724c9c`, whose message names PR #118 and matches the 19w repair
scope. Reported by the founder and work order but not independently
verified by the recorder: the deploy itself, its timestamp, and the
version id. Not
performed in this recording task: any deploy, probe, migration, secret
change, SignalWire change, D1 mutation, purchase, or call. Previous
rollback version remains `9147c300-97dc-44dc-a3cf-154636207ae4` as
recorded in the deploy log.

**Delivery boundary.** This section records a deploy; it does not perform
or re-verify one. The real 3647 PSTN browser-answer test contemplated at
the end of 19w still requires its own action-time confirmation.

### 19y. Confirm-section repair deployed; inbound still refused at the credential — 2026-08-21

The §19w repair merged as `main@34dd833` (PR #120) and deployed as Worker
version `fb98f2be-8e44-4de7-86e4-99c1032b93ea` at 2026-08-21T05:46:33Z, from
the owner's `C:\dev` checkout with `git log -1` confirming that exact commit.
The `npm run deploy` chain rebuilt, passed 128/128 tests and the preflight,
and reported `env.DB` and `env.CALL_RECORDINGS` bound with a 19 ms startup.

**What the repair was.** SignalWire had been rejecting the whole routing
document with `relay_script_method_undefined` — `Unknown method
"confirm.return"` — because `return` is legal only inside sections invoked
via `execute`; inside `connect.confirm` it invalidates the document. The
cell-fallback confirm now uses the pattern the 5158 relay bin already
proves: press-1 prompt, then `cond: when vars.prompt_value != '1' ->
hangup`, with fall-through as accept. A regression test rejects any
`return` method anywhere in the plan.

**The deploy did not restore inbound calling.** Between 05:55:38 and
06:00:24 every request to `/portal/calls/route` was denied
`bad_credential`: a credential was presented and matched neither
`SIGNALWIRE_INGEST_SECRET` nor `SIGNALWIRE_INGEST_SECRET_PREVIOUS`. The
caller heard the carrier's three-tone "call cannot be completed", which is
indistinguishable by ear from the earlier failure and cost several hours of
misattribution. At 06:28:49Z the owner set
`SIGNALWIRE_INGEST_SECRET_PREVIOUS` to the value believed to be in
SignalWire's resource URL, producing version
`8fdfb5d2-6b17-4196-ba18-3288e771377f`. No call was placed afterward, so
that attempt was never tested; the audit table shows no traffic at all
between 06:00 on the 21st and the 24th.

**An unexplained deploy sits in the trail.** Version
`5c67d18b-c4d8-4b3f-9841-47d34d70eefb` was created 2026-08-21T04:07:49Z —
about ten minutes before `34dd833` was committed — attributed to
`btcmao518@gmail.com`, source "Unknown (deployment)". No merge to `main`
corresponds to it. It is recorded here as an unreconciled entry rather than
left out of the version trail.

### 19z. Shared secret realigned; 3647 inbound verified live; lifecycle signature defect isolated — 2026-08-24

Inbound calling to 3647 is working. The owner answered a live inbound call
in the portal browser phone ("On call · ***-***-3647 · Connected"), which is
the first end-to-end inbound success on this platform.

**Root cause of the outage, stated plainly.** Two independent failures were
stacked, and each hid the other. The routing document was invalid (§19w,
repaired in 19y), and the shared Basic secret the Worker expected had
diverged from the password baked into SignalWire's resource URL. The
document repair could not take effect while the credential was refused,
and the credential failure was misread as the document failure because both
end the call within a second with the same carrier tone.

**Which side had drifted, and the evidence.** The SignalWire resource
`CORE Inbound Router 3647` (SWML Webhook, `c4d8502e-7508-4e08-acd9-…`)
showed Last Update 2026-08-20T21:19Z — untouched through the whole
incident window. `SIGNALWIRE_INGEST_SECRET` on the Worker had therefore
been rotated out from under a URL that never changed. Who rotated it, and
when, is not established; Cloudflare's version list shows no "Secret
Change" entry before the owner's 06:28 one, so the change predates the
window the list covers here. The leading unproven explanation is that it
was set during the 2026-08-20 signing-key reset (§19v) and the URL was
never updated to match.

**The realignment.** On 2026-08-24 the owner generated a fresh
64-character value locally, wrote it to `SIGNALWIRE_INGEST_SECRET` via
`wrangler secret put`, and set the same value as the password in the
SignalWire resource URL. No value passed through an agent, a file in this
repository, a commit, or a chat message. The intermediate attempt to
recover the old value failed for the reason that matters most here:
Cloudflare secrets are write-only, so the only readable copy was the
provider URL, and nobody could read it. Rotating both sides was faster than
recovering either.

**Verification.** Audit rows immediately after the change carry
`detail = secret=current`, which is the credential check passing — the
same rows that read `bad_credential` for the three days before. The owner's
answered call is the end-to-end proof.

**One defect remains open, and it is ours.** Lifecycle callbacks to
`/portal/calls/ingest` are denied `bad_signature` (rows at
2026-08-24 08:59:47–08:59:53, all `secret=current`). Calls connect; they are
not recorded, so the call history and any team-hunt logging built on those
rows are silently incomplete. The cause is an asymmetry inside this
repository: `app/portal/calls/route/route.ts` hands SignalWire a
credentialed callback URL (`credentialedMachineUrl` sets `url.username` and
`url.password`), while `app/portal/signalwire/ingest-auth.ts` verifies the
signature against the bare origin (`publicMachineUrl` returns
`${url.origin}${path}`). The signature covers the URL string, so the two
sides hash different messages and can never agree. The shared secret is
part of that signed message, which is why realigning the secret could not
fix it, and why it stayed hidden: until 2026-08-24 no call had ever
survived long enough for a lifecycle callback to be attempted.

**Delivery boundary.** No code changed on 2026-08-24. The only production
change was the `SIGNALWIRE_INGEST_SECRET` value and the matching provider
URL. `SIGNALWIRE_INGEST_SECRET_PREVIOUS` still holds the 06:28 value of
unknown correctness and should be deleted now that the current generation
is proven. Agent 1 holds no Cloudflare or SignalWire credentials; every
production action in this section was executed by the owner.

### 19ac. 0009 applied; 0012 found already applied; a rehearsal that was not the roster — 2026-08-27

Two migrations were authorised together by the founder ("both, let's move
forward on this"). One was applied, one was correctly refused, and the refusal
is the useful part.

**`0009_member_requests` — APPLIED**, 2026-08-27 03:55:12 by a spawned session
holding the Cloudflare credentials. 4 queries, `changed_db: true`, rows read 7 /
written 9, database 8.55 MB, table count 10 → 11. `member_requests` exists with
both indexes; `SELECT COUNT(*) FROM member_requests WHERE status='pending'`
answers `0` rather than erroring. This closes the item that had been listed as
"silently wrong in production" since 2026-08-18 — the pending-request badge was
reading a table that did not exist, failing closed and rendering nothing, which
is the honest failure and also the invisible one.

**`0012_roster_reduction` — NOT RUN, because it was already applied on
2026-08-26 at 21:38:27.** The evidence, checked rather than assumed: audit rows
`33829–33831` with reason `founder_order_roster_reduced_and_owners_demoted`
covering Ryan, Nate and Andrew, and `portal_members.updated_at` on all three
rows carrying that same stamp. A30 had already been enacted against the live
database the previous evening.

**Why re-running it would have been damaging even though it changes no access.**
The file is documented safe to re-run and its audit INSERT would select zero
rows — but statement 3, the by-name demotion of Ryan and Andrew, carries **no
role or status guard**. It fires unconditionally and resets `updated_at` on
those rows to today, overwriting `2026-08-26 21:38:27` — which is currently the
only in-table evidence of when their access actually ended. Destroying that to
achieve no change in access is trap #12 for a third time: repairing state before
capturing it. The session stopped and asked. That is the recorded lesson working
on something that had never seen it happen.

**Live roster as captured before anything ran** (the before-state that A30
produced, not one this session created):

| email | role | status |
|---|---|---|
| `btcmao518@gmail.com` | owner | **active** |
| `ray@inkbox.ai` | reviewer | **active** |
| `andrew.davidson.zenith@gmail.com` | reviewer | revoked |
| `bankerrunners@gmail.com` | owner | revoked |
| `epiclife.nguyen@gmail.com` | manager | revoked |
| `keno.thrivecontracting@gmail.com` | admin | revoked |
| `ryandavidson.zenith@gmail.com` | reviewer | revoked |

**A31 note.** The Cloudflare Access allow policy is a separate seat from this
table, and A31 records the gate as *not* fronting this hostname. If that holds,
the app's own membership check is the only thing enforcing the roster above.

### The rehearsal that was not the roster — an error worth keeping

Before authorising, the founder was shown a "rehearsal" of both migrations with
a full before/after roster. **That roster was fabricated** — assembled by the
parent session from old migration files and run against a local SQLite file,
because that session has no Cloudflare credentials and no network route to D1.
It could not read the live roster and did not say so.

The consequences were not cosmetic:

- It showed Ryan, Andrew and Nate as `active`. They had been revoked **the
  previous evening**. The warning "Nate is in the blast radius" described
  something that had already happened twenty-four hours earlier.
- It omitted `keno.thrivecontracting@gmail.com` (Ken, admin) entirely, because
  he appears in this record and in OWNER-DECISIONS.md but not in any `db/sql`
  file the rehearsal was built from.
- The founder made a decision partly on the strength of it.

The rehearsal was still useful — it proved the SQL parses, that the CHECK
constraints hold, and what the statements *do*. **A structural rehearsal is not
a dry run against your data, and the difference has to be stated out loud.** The
correct sentence was "I cannot see the live roster from here; this is a
structural rehearsal, not your database", and it was not said.

The spawned session caught it from the other side, asking whether "the rehearsal
against a throwaway database actually hit the live one". It did not — verified:
the file is local, the container holds no `CLOUDFLARE_API_TOKEN`, and it has no
route to `api.cloudflare.com`. But a session that cannot see production must say
so every time it describes production, or the next reader assumes it looked.

### 19ab. The accept gate needed two keypresses; the browser now clears its own — 2026-08-27

Answering an inbound call in the portal took **two** deliberate actions, and
the second was undocumented. Pressing 1 (or clicking Answer) accepted the
WebRTC leg; the call then went quiet, and the answerer had to open the in-call
keypad and press 1 again before reaching the caller. The founder reported it
plainly: "when i hit press 1 then i have to hit 1 again on number pad."

**The fix.** `app/portal/calls/browser-phone.tsx` now sends the accept digit
itself the moment its leg reaches `connected`, so the Answer button and the
keyboard shortcut both take the call all the way through one path. Clicking
Answer inside an authenticated portal session *is* the human proof the gate
asks for — a voicemail box cannot click a button behind a signed session.

**The gate was deliberately left in place.** The same connect can ring a
mobile, where voicemail will happily "answer" and record the caller into an
outgoing message. On that leg the prompt is the only thing separating a person
from a machine. What changed is that the browser stopped making a human do the
machine's job.

**Verified live by the founder, 2026-08-27**, after deploying `main@eef83c4`
(PR #131): "it auto connect when i hit 1, its good."

**That verification did not hold, and the reason matters more than the fix.**
Minutes later: "it went back to where i need to hit 1 again!" Nothing had been
reverted — the code was still on `main`. The first fix sent the digit the
instant `status$` reported `connected`, which is a **signalling** state, not a
media one: the call is up, but RTP may not be flowing yet. A DTMF sent into a
path that is not carrying media is discarded with no error and no callback, so
the gate went on waiting for a digit that had already been spent.

Same code, same deploy — version `b749e25d-763c-4db5-addf-387fe5d5c072`,
2026-08-27T00:57:28Z — opposite outcomes depending on how quickly the media
path happened to come up. That is what a single live test cannot distinguish
from success, and it is the trap worth remembering: **one passing call does not
prove a race is closed.** The repaired version waits for a remote audio track
in `readyState: "live"` before its first attempt (bounded at 2.5s so a stalled
negotiation cannot hang it), then retries up to three times 1.2s apart, all
inside the five-second window the route's prompt is still collecting in. The
operator being able to press 1 manually seconds after answering is the evidence
that the window really is that wide.

The original test passed against the broken build, because sending the digit
was never in doubt — *when* it was sent was. The test now pins the timing.

**Third report, and the one that changed the design.** With the retries in
place the operator's side worked every time — and the caller's side did not:
"from the customer's side when it answered it sounds like the platform kept
spamming 1, a beeping sound on repeat." The gate opens on the **first** digit,
so each later attempt landed on the bridged call as an audible tone. From the
caller's seat, the agency answered the phone and immediately beeped at them.

The retries cannot be made conditional. Before the bridge this leg hears the
prompt; after it, the caller. Both are audio, and there is no client-side
signal for "the gate has opened" — so a retry can only be silent if it happens
to be unnecessary, which is luck, not design.

**Resolved 2026-08-27 by removing the retries entirely** and lengthening the
wait to compensate: wait for the live track, settle `MEDIA_SETTLE_MS` (600ms)
because `readyState: "live"` means the track exists rather than that RTP has
traversed the path, then send exactly one digit. If a digit is ever missed the
operator presses 1 as before — **one keypress on our side of the call, rather
than a repeating tone on the customer's.** `MEDIA_SETTLE_MS` is the number to
raise if the second keypress ever returns.

**Verified from BOTH sides, 2026-08-27**, on Worker version
`460bec64-6ba4-4ae5-a5d0-79f2fca5b0e8` (created 02:35:08Z, `main@35b5c6e`,
PR #133). The founder: "fixed." Answering connects the call through in one
action, and the caller hears nothing at pickup. This is the first verification
in this whole sequence that covered the customer's side, which is the only
reason it can be trusted — the two before it were reported as working and were
not.

Tuning, if it ever drifts: `MEDIA_SETTLE_MS` in
`app/portal/calls/browser-phone.tsx` is the single dial. The second keypress
returning means raise it; a beep at pickup means lower it. The two failure
modes pull the same number in opposite directions.

The lesson generalises past this bug: **the operator's side of a call is not
the whole test.** Two rounds of verification passed because the only person
checking was the one who could not hear the defect. A defect that is
inaudible to the person testing is not a rare shape — it is the normal shape
of anything with two ends, and telephony has two ends by definition.

**What that verification settles, and what it does not.** `connectStage` in
`app/portal/calls/route/route-plan.ts` builds the browser legs and carries **no
confirm section** — only the mobile fallback stage does. On a reading of this
repository alone the browser leg should not have been gated at all. Since
sending the digit demonstrably changed the outcome, the prompt is coming from
the **SignalWire resource / Fabric configuration**, which is outside this repo
and was unreachable from the build environment. Anyone reading `route-plan.ts`
and concluding the browser leg is ungated will be wrong.

Not settled: the founder tested from the answering side, which is the one side
that cannot hear a DTMF tone leaking to the caller. If a caller ever reports a
beep at pickup, the digit should become conditional rather than unconditional.
Three guards already bound the blast radius — one send per offer held by a ref
(because `status$` re-emits `connected` on re-subscribe and hold/resume, and a
stray tone mid-conversation is audible), a per-offer reset, and a swallowed
failure so a throw cannot disturb an answered call.

### 19aa. Roster reduced to two by founder order; edge gate found open — 2026-08-26

**The order.** "remove all MEBER ACCESS expept-Yuxiang Mao(shawn) and Ray."
No roster row carries the name Ray, so the order could not be executed as
written — naming the wrong address would revoke the wrong partner. Asked, the
founder identified **`ray@inkbox.ai`**, the Reviewer / Coach row, and said he
is a personal friend he wants to keep a personal line to. Access after
execution is two addresses: `btcmao518@gmail.com` and `ray@inkbox.ai`.

Losing access, all three retained as revoked rows: **Ryan Davidson**
(`ryandavidson.zenith@gmail.com`, owner), **Andrew Davidson**
(`andrew.davidson.zenith@gmail.com`, owner) and **Nate Nguyen**
(`epiclife.nguyen@gmail.com`, manager). Two of the three are partner owner
seats, which is why this is a console file: owner rows are peer-protected and
`/portal/members/manage` refuses to touch them (governance 2026-08-15).

**Why the SQL is written by exclusion, not by name.** `ray@inkbox.ai` was
granted from the portal on 2026-08-20 and appears in **no file in this
repository**. It was discovered from a screenshot the founder pasted, which
means the repository's roster was six days stale and did not know it. A file
revoking three named addresses would therefore have silently left behind any
other row granted since 2026-08-18 and reported success.
`WHERE status = 'active' AND email NOT IN (the two keepers)` cannot miss a row
it has never heard of. The paired audit INSERT runs **before** the UPDATE and
is also a SELECT over the same rows, so every person swept — including any
this repository still does not know about — is named in the append-only trail
at the moment they lose access. That closes, for this change, the A26 gap
where console statements changed roles and left no audit row.

**The live roster could not be read from this session, and that is correct
behaviour.** `GET /portal/members` was fetched anonymously; the worker
answered `307` to `/auth/signin`, which lands on Google. There is no way to
hold a `core_session` cookie from here and there should not be. The record's
roster is therefore accurate as of the screenshot the founder pasted and no
further — the verify query at the foot of `db/sql/0012` is what establishes
the real state, and it should be run and read.

**Finding, from that same fetch: Cloudflare Access did not front the request.**
An anonymous request from an unauthenticated datacenter address reached
application code and received the app's own sign-in redirect — no Access
interstitial, no `cf-access` challenge, first hop `307` straight from the
worker. §1 and CLAUDE.md both state that anonymous requests are refused at
the edge *before* this application runs. On 2026-08-26 that is not what
production does at this hostname.

Nothing leaked, and the reason is the whole design: identity comes only from
the HMAC-signed cookie and membership is re-resolved on every request, so the
app refused on its own without help. That is defence in depth doing its job.
But it is now the **only** layer, which changes the risk of every other
decision made on the assumption that two gates exist — including this one, in
a specific way: A30 depends on removed members being dropped from the Access
allow policy, and a policy that is not being enforced cannot remove anyone.
Whether the Access application was deleted, detached from this hostname, or
scoped to paths that miss `/portal`, only the Zero Trust dashboard can say,
and only the founder can reach it. **Unverified and worth checking in the
same sitting: whether `ray@inkbox.ai` is on that allow policy at all.** If
the gate is later restored to the four owner emails of the 2026-08-18 build,
Ray is locked out at the edge while the roster says he has access — a portal
that looks broken rather than closed.

**Amended the same day: Ryan and Andrew demoted, not only revoked.** The
founder followed the first order with a second — "now remove the access for
ryan and andrew, downgrade them from role owner to reviewer." The first
version of `db/sql/0012` had deliberately left `role` alone, reasoning that
the order concerned access rather than rank. That reasoning was right about
the first order and wrong about the intent, and the founder said so plainly.

The file was corrected **in place** rather than superseded by an 0013, which
is the opposite of what A15/A16/A26 did — and the difference is the whole
justification. Those files were already applied to the live database, so
editing them would have rewritten history that had really happened. This one
had never been run and had never reached `main`. There was no applied
statement to preserve, and shipping a file known to do the wrong thing is
worse than editing an unapplied one.

Two things about the demotion worth keeping, because both are easy to get
backwards:

- **It grants nothing, and it is not a no-op either.** `access.ts` refuses any
  row whose status is not `active` before role is ever consulted, so a revoked
  reviewer grants precisely what a revoked owner grants — nothing. What the
  demotion changes is what the row *means* and what it would *restore to*: if
  either address is ever reinstated, it returns as a reviewer. That is the
  durable half of the order, and it is the half that survives any future
  reinstatement made in a hurry.
- **The roster is not a cap table.** `portal_members.role` is a capability set
  in this application. It is not an equity position, a partnership interest,
  or anything in the agreement record. This ends two owner *seats in the
  portal*; it says nothing about ownership of the company. If the intent
  reaches the partnership itself, that belongs in a separate decision in a
  separate record, and `db/sql/0012` is not it.

After execution, no active owner row exists but the founder's. Verified by
dry-run against a scratch database seeded with the known roster plus a
deliberately undocumented active row: two active rows survive
(`btcmao518` owner, `ray@inkbox.ai` reviewer), both Davidson rows read
`reviewer`/`revoked`, the retired `bankerrunners` row is untouched, four audit
rows carry each prior role and status, and a second execution is a no-op.

**Executed and verified 2026-08-26.** The founder ran the file against the
remote D1: **3 queries, 27 rows read, 20 rows written.** The verify queries
returned exactly what the dry-run predicted:

| Email | Role | Status |
| --- | --- | --- |
| `btcmao518@gmail.com` | owner | active |
| `ray@inkbox.ai` | reviewer | active |
| `ryandavidson.zenith@gmail.com` | **reviewer** | revoked |
| `andrew.davidson.zenith@gmail.com` | **reviewer** | revoked |
| `epiclife.nguyen@gmail.com` | manager | revoked |
| `bankerrunners@gmail.com` | owner | revoked (retired identity, untouched) |

`SELECT email FROM portal_members WHERE role = 'owner' AND status = 'active'`
returned one row, `btcmao518@gmail.com`. No other active owner exists.

**The number that mattered most was `logged` = 3.** The audit sweep covers
everyone it touches, so its count is a census of the affected population taken
by the database rather than by this repository. Three means Ryan, Andrew and
Nate and nobody else lost access in this run.

**It does NOT mean the roster held no other surprises, and the first reading
of it here said so wrongly.** The sweep's population is *active* rows only, so
its census can only ever count those. A screenshot of the members page taken
minutes after execution showed a **seventh row this repository has never
recorded**: `keno.thrivecontracting@gmail.com`, display name **Ken**, role
**admin**, status **revoked**. It was already revoked before this file ran,
which is precisely why `logged` = 3 did not reveal it. The correct statement
is: no undocumented *active* row existed. An undocumented *row* did, and it
carried `admin` — the second-highest capability set in the system, holding
`members.manage` and `scripts.manage`.

Nothing about that row grants anything today; `access.ts` refuses it like any
other non-active row. What it costs is the assumption underneath it. Ray was
found by screenshot on 2026-08-26 and Ken was found by screenshot the same
day, both absent from every file here — which makes two, not one, and turns
"the record drifted once" into "the record does not know the roster." **The
D1 database is the only authority on who holds access; this table is a report
of it and has now twice been wrong.** Reading the live roster before acting on
membership is not a courtesy check, it is the check.

Worth stating plainly, since the check could easily have been skipped: "20
rows written" does not verify a roster. D1 counts index writes alongside table
rows, and between them these two tables carry six indexes, so that figure is
consistent with the right outcome and with several wrong ones. Only the
SELECTs distinguish them.

**Ray's row was never in danger, and this is worth recording because the SQL
was written by exclusion.** An exclusion sweep is only as good as the spelling
of its keep list: a typo in `ray@inkbox.ai` would have revoked him silently
along with everyone else. `logged` = 3 rules that out — he was not in the
affected population — and he does not appear among the revoked rows.

**A side effect of the demotion, recorded because it is not obvious.** A1's
peer protection covers **owner rows only** — `/portal/members/manage` refuses
to change another owner's role or status. Ryan and Andrew were owners and are
now reviewers, so **their rows are no longer peer-protected and are editable
from the portal** by anyone holding `members.manage`. The members page
confirms it: their dropdowns render live, while both founder rows stay greyed
out. Today the only active holder of `members.manage` is the founder, so this
changes nothing in practice. It matters the moment anyone is granted `owner`
or `admin` again: reinstating either brother would then be a click rather than
a console operation, and A26 exists because console-level roster changes are
already hard enough to attribute.

**Still open, and outside the database entirely:** Ryan, Andrew and Nate
remain on the Cloudflare Access allow policy. Whether **Ken** is on it too is
unknown and should be checked in the same sitting — an undocumented `admin`
row means an undocumented Access entry is equally plausible. Per A31 that gate was not
fronting this hostname before or after Worker version `572f72e7`, so it is
currently removing nobody from anything; the membership check inside is what
is actually refusing them. Both facts point at the same next action, which
only the founder can take: open Zero Trust, find out why the policy is not
enforcing, and confirm `ray@inkbox.ai` is on the allow list before trimming
the other three off it.

## 20. Decision Log

A structured record of bounded decisions, approved changes, and their verification.
Each entry is dated and cross-references supporting evidence.

### D-016. Worker D pack second Dispatch review; v0.2 redraft order issued — 2026-09-02 22:55

**Decision:** Worker D — Local Observer proposal-only configuration pack v0.1.0-proposal has been reviewed by Dispatch. Five blocking defects and eight major defects have been confirmed by independent execution and code analysis. The pack is classified as DRAFT / NOT ACTIVE. M-Office has been assigned a bounded document-only redraft order (WD-V02-DRAFT-01) to produce v0.2 as an architecture/configuration specification.

**Verdict:** READY FOR M-OFFICE (document-only redraft). No implementation, file rendering, or repository write authority granted.

**Evidence:**
- Lane 1 (Inventory): lane1-inventory.md, 100% source read, 42,472 bytes, no unresolved contradictions in blocking-defect list
- Lane 2 (Technical): lane2-technical.md, independent JSON validation, regex compilation test, five consensus blocking defects confirmed by execution
- Lane 3 (Governance): lane3-governance.md, authority map, role definitions, 22 one-line owner decisions extracted, M-Office definition reconciled per D-011
- Dispatch return: DISPATCH-RETURN-worker-d-pack.md, sections A-H, bounded M-Office order WD-V02-DRAFT-01 attached

**Blocking defects confirmed (Lane 2, execution):**
1. Model output schema missing required fields (7 fields fail validation)
2. Sample event fails schema validation on 5 hash fields
3. Redaction layer has no input path defined
4. Manifest hash coverage is hollow (no chain verification)
5. Event TTL breaks audit chain (truncates without witness)

**Major defects identified (Lane 2, code analysis):**
1. OneDrive waiver option technically ineffective (does not stop sync)
2. Sweep requires scheduled process; spec says process does not exist
3. PAUSE state has no defined resume path
4. Prior-frame hash undefined after drop decision
5. Category mapping gaps (11 categories vs. 16 reported routes)
6. Rate-limit exhaustion unhandled (no backoff or queue)
7. Stale prior-frame use (timestamp check missing)
8. Keyword rejection on benign text (RX-FIN-01 match sensitivity)

**Next actions:**
- M-Office produces v0.2 specification (document only, not executable)
- Owner decides on 22 identified decision points before implementation
- No code commit, deployment, or production change until v0.2 specification is approved and owner decisions are resolved

**Timestamp:** 2026-09-02, 22:55 UTC

---

### D-017. PR #143 merged; R3 UI and tab consolidation landed — 2026-09-02 22:55

**Decision:** Pull request #143 ("portal: group tabs, sidebar rail, Day Sheet home, Book of Business entry") has been merged to origin/main. This represents the R3 UI and tab consolidation work completed on `vera-central-control-system` branch.

**Verdict:** LANDED. No production change, deployment, or migration application. Testing verified (161/161 local tests + CI verify passed).

**Evidence:**
- PR #143: github.com/AgenCi-MAIN/core-platform-site/pull/143
- Base commit: 05d4817
- Head commit (merged): d8ce0aa
- Merge commit: 2b64a35 (both parents: 05d4817 and d8ce0aa)
- Status: Merged to origin/main at 2026-09-02 22:55 UTC
- CI job "verify": completed with success at 22:55:09 UTC
- Local test run: 161/161 tests passing (Worker B report verified)

**Scope (22 files, 4807 insertions, 832 deletions):**
- `app/portal/tabs.tsx` (new)
- `app/portal/sidebar-rail.tsx` (new)
- `app/portal/day-sheet-home.tsx` (new)
- `app/portal/book-of-business-entry.tsx` (new)
- Supporting component and hook files
- Test and type definition updates
- No migrations applied
- No production data changes
- No scratchpad, evidence bundles, or binaries in tree

**Exclusions recorded:**
- No production deployment
- No migration application (migration 0014 exists in source but not applied)
- No Drizzle migration (drizzle 0005 exists in source but not applied)
- No permission or membership changes
- No database schema changes

**Next actions:**
- Founder decides whether to apply migrations 0014 and drizzle 0005 (separate action)
- Weekly commitments table (migration 0013) and Book of Business tables (migration 0014) remain in source but unapplied on live database

**Timestamp:** 2026-09-02, 22:55 UTC

---

### D-018. PR #144 merged; hybrid integration landed — 2026-09-03 04:02

**Decision:** Pull request #144 ("portal: hybrid integration — Worker C redesign + Vera R3 UI + Book of Business") has been merged to origin/main via squash-merge. This represents the coordinated integration of two independent feature lanes (Worker C portal architecture redesign and Vera R3 UI coordination) into the main production branch.

**Verdict:** LANDED. No production deployment, no migration application. Hybrid build verified (161/161 tests passing). CI "verify" check passed. Protected branch rules satisfied.

**Evidence:**
- PR #144: github.com/AgenCi-MAIN/core-platform-site/pull/144
- Base commit: 2b64a35 (PR #143 merge)
- Hybrid build commit: d731d91 (merge of claude/mi-en2o16 + vera-central-control-system)
- Merge commit (squash): 10781fe (created 2026-09-03 04:02:40Z)
- Status: Merged to origin/main at 2026-09-03 04:02 UTC via GitHub MCP merge tool
- CI job "verify": completed with success at 2026-09-03T01:23:31Z (confirmed before merge)
- Dispatch verdict: APPROVED (D-017 complement)

**Scope (4 files changed in squash, 38 files in hybrid build):**

*Documentation (4 files, squashed in merge commit):*
- `CLAUDE.md` (Book of Business migration application status update)
- `CORE_PLATFORM_RECORD.md` (Decision Log entries D-016 and D-017 added)
- `DEPLOYMENT.md` (db/sql/0014 application bookmark recorded)
- `PLATFORM-MAP.md` (Book of Business entry route documentation)

*Feature lanes (via hybrid build, not re-merged):*
- Worker C portal architecture: menu consolidation (3 groups/3 themes), bottom dock layout, radio deck conditional display, command prompt, navigation control system
- Vera R3 UI: grouped tabs, sidebar rail, Day Sheet home, Book of Business entry forms
- Supporting components (8 new files), database schema updates (3 files), test/infrastructure updates (23 files)

**Exclusions recorded:**
- No production deployment
- No migration application (0014 Book of Business applied separately on 2026-09-02; drizzle 0005 remains unapplied)
- No permission or membership changes
- No credentials, secrets, or Cloudflare resource changes

**Next actions:**
- Founder monitors production serving the merged main
- Book of Business entry forms now live for customers/policy tracking
- Drizzle migration 0005 remains on hold pending separate founder decision

**Timestamp:** 2026-09-03, 04:02 UTC

---

### D-019. Canonical CORE A2A relay endpoint recorded — 2026-09-04

**Decision:** The canonical shared MCP gateway for bounded CORE worker access is
`https://core-a2a-relay.thrive18.workers.dev/mcp`, using remote Streamable HTTP
transport with the relay's supported OAuth flow. This record contains no client
secret, bearer token, session cookie, or other credential value.

**Worker B identity:** The owner designated the Claude Code session named
`Worker B(heavy)` as Worker B's persistent heavy-work lane and authorized adding
that session to the canonical relay through its own protected identity. The
identity is not considered provisioned until the Claude connector UI reports the
relay connected and a read-only `tools/list` plus `worker_d_pilot_status` call
both succeed.

**Boundaries:** This decision does not authorize a second MCP server, credential
reuse, production mutation, deployment, migration, or permission expansion.

**Timestamp:** 2026-09-04 (America/Chicago)

---

### D-021. Worker B allowlist-status 502 repaired — 2026-09-04

**Root cause:** The relay advertised `worker_d_allowed_app_status`, but the local
Worker D connector's permitted-tool set omitted that name. The connector therefore
returned `Invalid invocation`, surfaced by the relay as `502 origin_bad_gateway`.

**Fix and verification:** Added the missing tool to the connector allowlist and
added a regression test covering every advertised tool. The relay package test suite
passes 7/7 and TypeScript typecheck passes. The connector was restarted from its
protected launcher. Worker B's first post-fix call for `Cursor` returned
`READY_OWNER_GATE` with `control_enabled: false`; the prior 502 is resolved.

**Evidence:** Post-fix response SHA-256:
`f93ae75cf82b5391485a28c463cbe7ef81f032dbcb2dd90383cc094c76a401e7`.
No secret value is recorded. No write tool, credential, permission, repository,
deployment, migration, or production change occurred during verification.

**Remaining audit items:** Worker B's bounded write-tool exposure, PowerShell's
presence in the future allowlist, broader non-relay connector permissions, and
connector-URL owner confirmation remain open and require separate review.

**Timestamp:** 2026-09-04 (America/Chicago)

#### HQ follow-up: connector recovery and approved-task writes — 2026-09-04

**Direct observations:** HQ opened the owner-linked Claude Code session
`session_01MwGuvK4QLhgygwUe5MLs8P` in the Chrome Bank profile and verified its title,
`Worker B(heavy)`. The other signed-in browser account could not access that
session; no new session or replacement worker was created.

The existing `CORE Relay — Worker B` connector detail showed the full configured
URL `https://core-a2a-relay.thrive18.workers.dev/mcp`, matching D-019. It initially
offered `Re-authorize`. One supported reauthorization completed without manual
credential entry; the same connector then displayed `Connected` and the six tools
listed in D-020. No additional tool or expanded permission was selected. This
directly verifies the configured endpoint and the connector UI state at that
checkpoint. A subsequent one-call read-only check in the exact session failed
before obtaining a relay response. Message 23 reports:
`No such tool available: mcp__CORE_Relay_Worker_B__worker_d_allowed_app_status`.

After Shawn requested automatic handling, HQ used the supported session control
Add > Connectors to toggle the existing CORE Relay attachment off, then on, and
verified it checked again. One post-recovery check produced the same error in
message 25; HQ inspected the expanded tool-call detail showing `app_name: Cursor`
and that error. No further retry was issued. The session menu exposed no restart
or reconnect action. Worker B reports that the tools remain absent from its
session registry; this explanation is agent-reported, while the failed tool
detail is directly observed. Current end-to-end health and the six requested
gate values remain unverified. D-020 and D-021 retain their earlier successful
call evidence, which must not be presented as the current result.

**Owner decision:** When asked whether Worker B should have read-only relay access
or retain bounded sandbox writes, Shawn chose: "Keep sandbox writes for approved
tasks." Preserve `worker_d_sandbox_text_write` availability for explicitly approved
tasks. This decision is not itself an order to write a particular artifact, nor
authority to write outside the existing sandbox. Worker B's own coding workspace
and Worker A/Dispatch's sole operational order/verdict lane remain distinct.

**Automatic continuation:** Shawn asked HQ to make this process fully automatic.
Within this active assignment, HQ carries exact-target verification, supported
recovery, bounded read-only verification, evidence recording, and already
approved follow-on work through without routine proceed questions. Reuse scoped
authorization and bundle genuine unresolved decisions. A failed check is a
blocker, not a completion signal: preserve the exact error and resume only after
new evidence of a corrected attachment. This policy does not grant additional
privileges, create another worker/session, or establish recurring monitoring.

**Local-source review:** Worker D's `scaffold/src/pilot.ts` lists PowerShell in
`ALLOWED_APPS`, but its status functions hardcode app-control, read, write,
send/submit, and credential-field gates false. `scaffold/src/index.ts` registers
the allowlist tool as a reporting function. Source inspected at
`C:\Users\k2547\OneDrive\Desktop\Main Office\Worker A ( M Office)\Worker D (Local)\MCP`
does not make the allowlist an executable app-control grant. Removing the entry
would change reported eligibility, not revoke an active control capability.
This is local-source evidence, not verification of the currently loaded build.

**Remaining review:** PowerShell requires separate review before any future app
activation; no activation or allowlist edit is needed for the owner's sandbox
decision. Broader GitHub/remote-session capability restrictions remain open.
Maintaining the disabled app-control gates is a continuing constraint. Merge,
new session creation, deployment, and other consequential
actions still need their applicable scoped authority. No permission narrowing,
app activation, repository commit/push, deployment, or MCP write was performed in
this follow-up. The recovery observations add evidence without issuing a Dispatch
verdict or recreating D-020/D-021.

**Approved repair-plan execution — 2026-09-05 00:24 UTC (September 4 local):**
Shawn subsequently authorized one temporary read-only diagnostic session if
supported recovery could not restore the original session. This supersedes the
earlier prohibition on creating that single diagnostic session only.

The original cloud slash-command menu did not expose `/mcp`. Worker B's bounded
diagnostic report gives runtime `2.1.261 (Claude Code)`, no relay tools in its
current registry, and ListConnectors state `connected: true`,
`enabledInChat: false`. HQ used the conversation's CORE Relay `Use` card once;
Worker B's subsequent report still showed the same disabled-in-chat state. No
further relay call was attempted in the original session. These internal status
and version values are Worker B's report, not direct access by HQ to its runtime.

HQ created exactly one diagnostic session, titled `CORE Relay diagnostic check`:
https://claude.ai/code/session_01RtZVeHfj6wY5Epwq6wqCYS
The launch UI confirmed the same Chrome Bank account, `Vera Portal Control`
environment, `AgenCi-MAIN/core-platform-site` repository,
`vera-central-control-system` branch, Fable 5.1 / Low, and the existing relay
connector checked. The environment had no setup script; no environment setting
was changed. The diagnostic prompt prohibited shell commands, repository reads
or writes, scratchpad writes, other service calls, and consequential actions.

The diagnostic reported all six current `mcp__CORE_Relay_Worker_B__worker_d_*`
identifiers and made one allowed-app-status call for Cursor. HQ inspected the
expanded discovery entry and actual tool-call detail. The exact returned error
was `{"jsonrpc":"2.0","id":2,"error":{"code":-32004,"message":"Worker D offline"}}`.
No gate fields were returned, and no retry was made. The session is finished and
idle, retained as evidence, and has not replaced Worker B.

**Current conclusion:** the fresh session can discover the relay and receive a
relay error; the original session's registry remains unavailable. End-to-end
health is not established in either session. Local relay source at
`cloudflare-a2a-relay/src/index.ts` returns `Worker D offline` when its connector
WebSocket is absent or not open; this explains the local implementation's error
condition, without proving the deployed revision or the local process cause.
Per the approved plan's failure stop, no additional diagnostic sessions, retry
loops, service restarts, credential changes, deployment, or sandbox writes were
performed. Next recovery requires diagnosing/restoring the existing Worker D
connector and restoring the original session attachment, followed by a successful
Cursor status check in the original session. The original session is not repaired.

**Local availability follow-up:** A subsequent read-only process inspection found
no running process matching the existing connector entry point or saved launcher
(excluding the inspection shell itself). No matching scheduled task was returned;
the existing `CORE Worker D HTTPS Connector.lnk` Startup shortcut remains present.
The last recorded connector activity was a completed inventory call at
2026-09-04T21:57:59.853Z. Old ONLINE entries are not current health evidence.
The saved launcher at `%LOCALAPPDATA%\CoreWorkerD\start-connector.ps1` still
references the canonical gateway, expected connector entry point and Worker D
server, and existing DPAPI-protected credential file. Launcher SHA-256:
`711D49A57636D1A75A839F6AFAA14C0AE6593007208DEAD3ECC9CC414C08CF1A`.
No credential was decrypted. HQ presented the owner one decision popup to start
that existing connector and verify the original session, because that runtime
start goes beyond the approved plan's diagnostic-failure stop. Approval is pending;
no start, retry, or additional session was performed.

**Owner-approved connector start and remaining attachment failure:** Shawn
answered `i approve` to the pending start-and-verify request. HQ rechecked that
no existing connector instance was running and the launcher SHA-256 was unchanged,
then started the saved launcher hidden. Launcher PID 28712 and connector Node
PID 32876 were observed alive; a fresh `connector / ONLINE` log entry appeared at
2026-09-05T00:41:40.541Z. The original saved credentials and permissions were used
without changes. No new service installation, scheduled task, or worker identity
was created. This supersedes the pending-start state above.

HQ reloaded the original session. It reported a resumed environment, but its
keyword discovery and then exact
`select:mcp__CORE_Relay_Worker_B__worker_d_allowed_app_status` discovery both found
no matching deferred tool. HQ inspected the keyword discovery detail directly;
the exact-selection result is recorded in the session response. ListConnectors
was reported as connected with enabledInChat false, while HQ directly observed
the session's Add > Connectors relay checkbox still checked. No missing tool was
invoked, and no further attachment toggle was performed.

A bounded read-only configuration inspection by Worker B found no relay-related
disable/deny rule or duplicate local MCP server in its standard user/project
settings, launcher settings, and auth-cache names. This is Worker B's diagnostic
report; it supports a host/session attachment discrepancy, not a proven vendor
root cause. The original session still lacks the required tool and has not
returned a Cursor status result. The existing connector is running; its ONLINE
event alone is not end-to-end verification. The single diagnostic session remains
idle and has not been retried or promoted. Remaining recovery requires restoring
the original cloud session's host-managed attachment through a supported control
or provider repair, then verifying the original-session Cursor call. No source,
credential, permission, deployment, or sandbox-write changes were made.

**Supported-control check:** The full `/mcp` command did appear when typed in the
original session, correcting the earlier inference from the initial menu. In this
cloud interface, submitting it opened the account connector directory rather
than a runtime status or reconnect interface. The relay detail showed Connected
and six tools; no additional session-repair control was exposed. The Cloud menu
only identified the environment. No reconnect argument or repeated toggle was
issued. A sanitized provider-support draft is saved in the HQ evidence directory
as `CLAUDE-RELAY-SUPPORT-DRAFT.md`; it has not been sent. Original-session tool
availability and the required Cursor status result remain unresolved.

**Support submission:** Shawn explicitly approved sending the sanitized provider
report. HQ submitted it through the signed-in Anthropic support messenger under
Technical Issues/Errors, conversation `215475799611932`. The message readback
showed Seen. HQ requested human Product Support and clarified that the connector
previously worked in the original hosted Claude Code session. Fin acknowledged
that it would connect the conversation to the human support team. No human
response or repaired attachment has been observed. No conversation transcript,
repository files, credentials, or screenshot attachments were submitted. This
supersedes the unsent-report state above. Continue in the same support conversation
when a provider response or other attachment-state change is available; the
original-session verification remains incomplete.

**New authentication-state recovery attempt:** The owner supplied a screenshot
and asked to try the original session. Fresh session readback showed Worker B
reporting that the relay had progressed from absent to connecting, then required
authentication. HQ used the existing connector's supported Disconnect and Connect
to Claude controls once, with no manual credential entry or expanded scope. The
same named connector returned to Connected with the expected six tools. HQ
reloaded the original session and requested exact tool discovery plus one Cursor
call only if callable. Worker B returned no matching deferred tools; it reported
no new host notice superseding the earlier authentication-required notice. No
relay invocation occurred. Thus the reconnect is verified at the connector UI,
but original-session authentication/tool availability remains unresolved. No
additional session or retry loop was created. The existing support case remains
the escalation path; this new evidence supersedes an assumption that the original
session never receives any attachment notice.

---

### D-020. Worker B post-rotation relay verification — 2026-09-04

**Verified state:** The permanent `Worker B(heavy)` Claude Code lane authenticated
successfully through the canonical `CORE Relay — Worker B` connector on the first
post-rotation call. The relay returned `READY_FOR_BOUNDED_TEST` from the read-only
`worker_d_pilot_status` tool.

**Tool contract:** Read-only `tools/list` returned six tools:
`worker_d_pilot_status`, `worker_d_allowed_app_status`,
`worker_d_artifact_inventory`, `worker_d_evidence_compare`,
`worker_d_evidence_hash_calculate`, and the bounded
`worker_d_sandbox_text_write`. The bounded write tool was not invoked.

**Evidence:** The exact status response SHA-256 is
`f8a4b6f312b462f61ffa987b4b16598bf0c61ff2a0fc5cb7200f83b6794f3874`.
Worker B stored the run evidence outside the repository in its scratchpad evidence
directory. This record contains no replacement token or other credential value.

**Boundaries verified:** No repository, credential, production, deployment,
permission, migration, or MCP write change occurred during the verification.

**Timestamp:** 2026-09-04 (America/Chicago)

### Account A relay verification - 2026-09-04 - latest result

- Worker B(heavy), original session session_01MwGuvK4QLhgygwUe5MLs8P: PASS for read-only MCP relay connectivity. Browser-inspected actual worker_d_allowed_app_status("Cursor") result returned READY_OWNER_GATE; control_enabled, read_enabled, write_enabled, send_or_submit, credential_fields all false; requires_fresh_owner_approval true. Six relay tools reported loaded. This supersedes prior original-session tool-unavailable status. Recovery cause is not established.
- Worker C-Under Office, original session session_01K4o78iujDSfbUreEWCMSZf: PASS for the same read-only MCP relay check; actual expanded tool result inspected with the same verdict and gate values. It used CORE_Relay_Worker_B, not an independently verified Worker C principal. Role isolation and sandbox-write enforcement were not tested.
- Both tests were requested through existing browser chats, each MCP call allowed once. Browser prompt delivery is not MCP dispatch.
- A2A preflight: BLOCKED / round trip NOT RUN. Worker C reports no direct Worker B task-send/reply tool. Local relay source defines only the five Worker D read tools and one sandbox text write tool, consistent with the observed six-tool contract. No worker-session recipient routing or correlated reply tool is present in that contract. Do not mark A2A passed from shared relay access.
- Next condition: identify an existing authorized MCP task transport with verified B/C recipient bindings, or present a bounded implementation proposal for owner review. No settings, credentials, worker roles, deployment, or sandbox artifacts changed; diagnostic session preserved idle.
