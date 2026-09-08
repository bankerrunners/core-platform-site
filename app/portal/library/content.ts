/**
 * IMO portal library — the documents members read.
 *
 * CONTENT PROVENANCE RULE
 *
 * Every document carries a `status`:
 *   - "approved"  Owner-supplied or owner-signed. Rendered verbatim. J.A.R.V.I.S.
 *                 must not reword it.
 *   - "draft"     Drafted for the owner to edit or approve. Displayed with a
 *                 visible DRAFT marker so no member mistakes it for policy.
 *
 * Nothing here may state a figure, a date, a carrier term, a compensation
 * promise, or a company fact that the owner has not supplied. Draft copy
 * describes how IMO works from the operating model already recorded; it does
 * not invent history, headcount, results, or commitments.
 */

export type LibraryBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "numbered"; items: readonly { title: string; body: string }[] }
  | { kind: "quote"; text: string };

export type LibraryDocument = {
  id: string;
  title: string;
  summary: string;
  icon: string;
  status: "approved" | "draft";
  /** Where the content came from. Required. */
  provenance: string;
  /** Set when the content is time-limited, so it cannot quietly go stale. */
  expires?: string;
  blocks: readonly LibraryBlock[];
};

/**
 * Emptied 2026-08-26 for the IMO Operating Portal changeover; the previous
 * operator's documents are unpublished, not deleted, and remain restorable
 * from the git ref `backup/thrive-content-2026-08-26`.
 *
 * Repopulated 2026-09-08 with five documents describing how this portal
 * actually behaves. Every one is `status: "draft"` and renders with the DRAFT
 * marker — none is owner-approved, and none states a figure, date, carrier
 * term, or compensation promise. Each was drafted from repository source and
 * then independently fact-audited against that source. The audit removed a
 * line that had been styled as an owner quote but originated with the drafter,
 * and corrected several claims that overstated what the code actually
 * enforces — notably about roster visibility and J.A.R.V.I.S.'s isolation.
 */
export const LIBRARY: readonly LibraryDocument[] = [
  {
    id: "welcome-to-the-portal",
    title: "Welcome to the portal",
    summary: "What this portal is, the two checks that stand between you and it, and what to do when a page will not open.",
    icon: "🔑",
    status: "draft",
    provenance: "Drafted from the repository's own operating record and source: CLAUDE.md, CORE_PLATFORM_RECORD.md §§1-3, app/portal/access.ts, app/portal/no-access/page.tsx, and app/access/page.tsx. Draft — not yet owner-approved.",
    blocks: [
      { kind: "paragraph", text: "This is the operating portal. It is a private workspace, not a public website. Everything under /portal is closed by default and opens only to people who hold a membership record, at the role that record carries." },
      { kind: "heading", text: "Two checks, not one" },
      { kind: "paragraph", text: "Every request you make runs through two independent checks on the server. They are separate on purpose, and passing the first one does not get you past the second." },
      {
        kind: "numbered",
        items: [
          { title: "Identity", body: "Sign in with Google proves who you are. The portal accepts only a Google address the provider reports as verified, and it holds your session in a signed cookie of its own. Nothing you can send in a request header ever establishes who you are." },
          { title: "Membership", body: "An active row in the portal_members table proves you belong here and fixes your role. That row is created for you by an owner or an administrator before your first sign-in. It is never self-served." },
        ],
      },
      { kind: "quote", text: "Identity alone grants nothing. Anyone on earth can complete step one." },
      { kind: "paragraph", text: "That sentence is the whole design. Step two is what actually protects the portal, which is why signing in successfully and still being refused is a normal outcome rather than a bug. The first time you sign in, your Google account is bound to your membership record permanently, so that nobody who later obtains your address can step into your access." },
      { kind: "heading", text: "Sign in with the right address" },
      { kind: "paragraph", text: "Use the Google account whose email is the same address you gave during onboarding. A different Google account — including your own personal one — will be refused, because the portal matches your Google identity against the address it has on file for you. The sign-in intake page lets you type an address to remind yourself which one to use; it does not check that address against anything, and it answers identically for a member and a stranger. That is deliberate: a page that told you whether an address is a member would let anyone map the roster." },
      { kind: "heading", text: "Your role decides what opens" },
      { kind: "paragraph", text: "Six roles exist: Owner, Administrator, Manager, Reviewer / Coach, Agent, and Support. Each role holds an exact, listed set of capabilities and nothing else — permissions are deny-by-default, so a page your role does not hold stays shut until an owner or administrator changes your role. A few surfaces are narrower still and answer to a named identity rather than to any role. Rosters follow a separate rule: you see yourself, your peers at the same rank, and the ranks below you — never your upline." },
      { kind: "heading", text: "The portal fails closed" },
      { kind: "paragraph", text: "If the membership database is unreachable, or the deployment has not had its migration applied, the portal refuses access rather than assuming it. You will see a page saying the portal is not provisioned. Nothing is wrong with your account in that case, and there is nothing you can do from your side; an administrator has to fix the deployment." },
      { kind: "paragraph", text: "Every allow and every deny is written to an append-only audit log. Your refusals are recorded as faithfully as your entries." },
      { kind: "heading", text: "If a page says you cannot open it" },
      { kind: "paragraph", text: "You will be sent to an explanation page that names the actual reason. Read the heading — it distinguishes between quite different situations, and the right next step depends on which one you got." },
      {
        kind: "list",
        items: [
          "Sign in required — your session was not recognised. Sessions expire; sign in again.",
          "No IMO membership — your identity was confirmed, but that account has not been granted IMO portal membership. If you have finished onboarding and have not been assigned access yet, text your personal recruiter. They request access on your behalf.",
          "Additional permission required — you are a member in good standing, and this particular area is not part of your role. An owner or administrator can change that. Ask; do not work around it.",
          "Access suspended or revoked — an owner or administrator can restore it. If a reason was recorded, the page shows it.",
          "Account mismatch, or two memberships match you — the portal refuses rather than guessing which record is yours, so that nobody's access can be taken over by mistake. An owner or administrator has to resolve the records.",
          "Portal not provisioned — a deployment problem, not an account problem.",
          "Membership needs repair — your membership record carries a role the portal does not recognise, so its permissions are undefined. Access is refused rather than guessed; an owner or administrator has to correct the record.",
        ],
      },
      { kind: "paragraph", text: "One habit is worth forming on day one: when something will not open, quote the heading you saw when you ask for help. The headings are distinct because the underlying causes are, and naming the right one usually turns a long conversation into a short one." },
    ],
  },
  {
    id: "roles-and-access",
    title: "Roles and access",
    summary: "What each portal role can open, why access is deny-by-default, and how every allow and deny is recorded.",
    icon: "🔑",
    status: "draft",
    provenance: "Drafted from the repository source: app/portal/access.ts (CAPABILITIES, ROLE_CAPABILITIES, ROLE_LABELS, the guards), db/schema.ts (audit_events), the requireCapability call sites in app/portal/*/page.tsx, and CLAUDE.md.",
    blocks: [
      { kind: "paragraph", text: "This page explains who can open what in the portal, and why the answer is usually \"no\" until someone deliberately says yes. It describes the access model as it is written in app/portal/access.ts. If this document and that file ever disagree, the file is right." },
      { kind: "heading", text: "Two checks, every request" },
      { kind: "paragraph", text: "Two independent things stand between you and any protected page. First, identity: Sign in with Google proves who you are. Second, membership: an active row in the portal_members table proves you belong and fixes your role. Identity alone grants nothing — anyone with a Google account can finish step one. Both checks run on the server on every request." },
      { kind: "paragraph", text: "If the database cannot be reached, or has not been migrated, the portal refuses rather than guessing. It fails closed. That is the intended behaviour, not an outage workaround." },
      { kind: "heading", text: "Deny-by-default" },
      { kind: "quote", text: "Deny by default: a role holds exactly the capabilities listed here and nothing else." },
      { kind: "paragraph", text: "Access is not a dial that opens wider as you become more senior. It is a set. Each role is a named list of capabilities, and a capability you are not on the list for is refused — there is no fallback, no inheritance, and no \"senior enough\" shortcut. Pages are guarded by requireCapability; writes are guarded by assertCapability. A write that fails the check throws rather than redirecting, so it cannot silently half-succeed." },
      { kind: "paragraph", text: "There is a separate seniority ladder in the source, but it decides only who appears in a list — a roster or a leaderboard. It decides nothing about what anyone may do. The comment in access.ts is blunt about why the two are kept apart: a rank comparison quietly invites \"greater than or equal means allowed\", which turns a visibility ladder into an authorization ladder nobody voted for." },
      { kind: "heading", text: "The roles" },
      {
        kind: "numbered",
        items: [
          { title: "Owner", body: "portal.access, dashboard.view.self, book.view.self, book.edit.self, calls.answer, calls.review, calls.review.self, calls.recording.delete, scripts.manage, team.view, leadership.view.all, members.view, members.manage, pet.chat." },
          { title: "Administrator", body: "portal.access, dashboard.view.self, book.view.self, book.edit.self, calls.answer, calls.review.self, calls.recording.delete, scripts.manage, team.view, leadership.view.all, members.view, members.manage, pet.chat. Note what is absent: an administrator can delete a recording but cannot review one." },
          { title: "Manager", body: "portal.access, dashboard.view.self, book.view.self, book.edit.self, calls.answer, calls.review.self, team.view, leadership.view.all, members.view, pet.chat. A manager can see the roster but cannot manage it, and cannot delete a recording." },
          { title: "Reviewer / Coach", body: "portal.access, dashboard.view.self, calls.answer, scripts.manage, team.view, pet.chat. A staff function rather than a rung on the sales ladder; it carries no Book capability." },
          { title: "Agent", body: "portal.access, dashboard.view.self, book.view.self, book.edit.self, calls.answer, calls.review.self, pet.chat." },
          { title: "Support", body: "portal.access, dashboard.view.self, calls.answer, team.view, pet.chat." },
        ],
      },
      { kind: "paragraph", text: "Those six are the only roles the portal recognises. The role column in the database is plain text, so a value that is not one of the six has no capability set at all; the portal refuses that session rather than issuing one whose permissions are undefined." },
      { kind: "heading", text: "What the capability names mean" },
      {
        kind: "list",
        items: [
          "portal.access — you are an active member at all.",
          "dashboard.view.self — your own dashboard, and the pages guarded by it, including the Library you are reading now.",
          "book.view.self and book.edit.self — read and hand-enter your own Book of Business. Every row is scoped to your own membership; the capability alone never names whose book it is.",
          "calls.answer — answer in the browser. It is intentionally broad across roles but stays inert without an active number assignment and live presence.",
          "calls.review — review any call; both call-review pages are guarded by it. calls.review.self is a separate capability, not a weaker version of it: it is written to answer \"this call, if it is mine\", and a capability alone cannot know whose call it is, so a route using it would have to test ownership against the row as a second check. No route in the portal asserts it today — the review pages check calls.review only.",
          "calls.recording.delete — a separate power from reading a recording. Retention is a records duty, so it is held by a role that cannot review as well as by one that can.",
          "scripts.manage, team.view, leadership.view.all, members.view, members.manage, pet.chat — scripts, your team view, the leadership surfaces, the roster, roster changes, and the assistant.",
          "audit.view — defined in the source but held by no role. The audit log is closed by identity instead.",
        ],
      },
      { kind: "heading", text: "Gates that no role opens" },
      { kind: "paragraph", text: "A few surfaces are closed by identity rather than by capability. The audit log, the investigator, and the personal Command Center pages answer only the founder identity — a second owner does not inherit them. The Command Center itself is gated on a named allowlist, and for everyone on that list except the founder a single-use pass is still required to open it. Being named is necessary and not sufficient." },
      { kind: "heading", text: "Adding a capability" },
      { kind: "paragraph", text: "Widening a role is a governance decision, not a convenience fix. The source requires the change to be recorded in CORE_PLATFORM_RECORD.md under Roles and capabilities, and tests pin the identity allowlists so a quiet addition fails in CI rather than shipping. If you are blocked on something you believe you should be able to do, ask for the capability to be granted; do not route around the check." },
      { kind: "heading", text: "Everything is logged" },
      { kind: "paragraph", text: "Every allow and every deny is written to the append-only audit_events table: when it happened, the actor's email, subject id and role, the action attempted, the resource, the request path, the decision, and a machine-readable reason such as not_a_member, capability_not_held, or capability_granted. Rows are appended and never edited, which is why the reasons are written honestly — a founder-only refusal is recorded as founder_only, a Command Center refusal as command_only." },
      { kind: "paragraph", text: "The request path on a row is stated by the code that made the decision, never read from a request header, so the log cannot be authored by the person being audited. If the log itself is down, a member entitled to a page still gets it; the gap is surfaced on the server rather than turned into a refusal." },
    ],
  },
  {
    id: "answering-calls",
    title: "Answering calls",
    summary: "How the Inbound and Calls pages work: presence, the hunt, callbacks, and what is and is not recorded.",
    icon: "📞",
    status: "draft",
    provenance: "Written from the portal source: app/portal/inbound/page.tsx, app/portal/inbound/availability/route.ts, app/portal/inbound/availability-control.tsx, app/portal/calls/ (page, workspace, bootstrap, presence, callback claim, voicemail audio, recording, ingest), app/portal/access.ts, and db/schema.ts. Draft; the owner approves it later.",
    blocks: [
      { kind: "paragraph", text: "This is the inbound call surface. It is two pages that do different jobs. /portal/inbound is the status view — what rang, what is owed, and whether you are on the line. /portal/calls is the workspace where you actually go available, answer, and work voicemail. Both are guarded by the same capability, calls.answer, and both refuse anyone who does not hold it." },
      { kind: "heading", text: "Who can open it" },
      { kind: "paragraph", text: "calls.answer is held by every role listed in ROLE_CAPABILITIES in app/portal/access.ts: owner, admin, manager, reviewer, agent, and support. Holding the capability is not enough to make your browser ring. The comment in that file is explicit: answering stays inert without an active number and subscriber assignment. Capability, active membership, an assignment, and live primary-browser presence are all required." },
      { kind: "heading", text: "What the Inbound page shows" },
      {
        kind: "list",
        items: [
          "Five tiles: answered today, answered this week, callbacks open, missed today, median answer. The last two render as pending — the page states in its own copy that there is no missed-call source and no timing source yet.",
          "A callback queue, showing the masked caller number and the due time, marked past due when overdue.",
          "An \"On the line\" card with your own presence: Available, On a call, or Offline.",
          "Team presence, which is shown as protected and is deliberately not displayed.",
        ],
      },
      { kind: "paragraph", text: "The page reads only self-scoped tables plus your own voice_presence row. It places no call, records nothing, and carries no dialer. The header buttons, the presence card, and the queue footer all link into /portal/calls. A callback row itself opens the customer in the Book for roles that hold book.view.self, and the voicemail tab in Calls for everyone else." },
      { kind: "heading", text: "Presence and availability" },
      { kind: "paragraph", text: "Presence is one row per member in voice_presence (db/schema.ts): a ready state, one browser session id, a last heartbeat, and an expiry. Three things follow from that shape." },
      {
        kind: "numbered",
        items: [
          { title: "One tab is primary", body: "voice_presence holds a single browser_session_id per member, with a unique index on it. /portal/calls/presence rejects an update from any tab that is not the registered one with \"This tab is not the primary phone session.\" Keep one CORE tab open." },
          { title: "Presence expires on its own", body: "The registration carries an expiry (PRESENCE_TTL_MS in voice-server.ts) and the browser sends a heartbeat well inside it (PRESENCE_HEARTBEAT_MS). If the expiry passes, the presence route refuses a late heartbeat rather than resurrecting a stale tab — you register the browser again. Expiry is the independent backstop that removes a dead browser from the hunt." },
          { title: "Going Available is an audited decision", body: "The presence route writes the audit row before it makes you ringable, and returns an error instead of going available if that row cannot be written. Going Offline is the fail-safe direction: it is never blocked by an unavailable audit sink." },
        ],
      },
      { kind: "paragraph", text: "Only an explicit Available state plus a live primary-tab heartbeat enters the hunt. Routing itself is enforced server-side and is not displayed to you." },
      { kind: "paragraph", text: "One thing to keep straight. There is a second, separate availability idea in the source: app/portal/inbound/availability records a stated readiness preference into the audit stream and, in its own words, is not sent to the carrier and routes no call. The component that would render that toggle, availability-control.tsx, is not imported by any page today. The presence row under /portal/calls is the one that governs ringing." },
      { kind: "heading", text: "The Calls workspace" },
      { kind: "paragraph", text: "Four tabs for everyone who holds calls.answer: Live, My History, Call Lab, Voicemail. A fifth, Outbound, appears only for the founder. Live shows your computer availability, your assigned line, and the open callback count. My History shows your own calls — scoped in the bootstrap route to calls assigned to you, accepted by you, or offered to you, through voice_call_offers. The founder is the exception: for that session the same tab returns authorized company call history. Call Lab is company-wide review and requires calls.review; without it the tab says so and points you back to My History." },
      { kind: "heading", text: "Offers and callbacks" },
      { kind: "paragraph", text: "An inbound call becomes a row in inbound_voice_calls with a routing stage and a status. Each member's ring is a row in voice_call_offers, unique per call, stage, attempt, and member, so a repeated event cannot create a second offer. If someone else takes it first, your phone reports answered elsewhere rather than pretending it vanished. While an offer is ringing and the phone panel is open, keyboard 1 answers; it does nothing at any other time, and nothing while you are typing in a field." },
      { kind: "paragraph", text: "When a call ends in voicemail, a row appears in voice_callback_tasks — at most one per inbound call — with a due time and a status. It may be assigned to you, or sit unassigned in the shared queue. To claim a shared one you must currently be Available: the claim route checks your presence row and answers \"Become Available before claiming a shared callback\" if you are not. The claim itself is a conditional update, so if two people press at once, one gets it and the other is told the callback is no longer available. Claiming is audited before the task changes hands." },
      { kind: "heading", text: "Recording and consent" },
      { kind: "paragraph", text: "Be precise about this, because members will be asked about it." },
      { kind: "quote", text: "Live employee and customer conversations are not recorded, transcribed, or joined by AI; only the announced voicemail stage records audio. — app/portal/calls/page.tsx" },
      { kind: "paragraph", text: "Voicemail audio lives in the recordings bucket and is served by /portal/calls/voicemail/audio, which returns the file only for a task assigned to you or claimed by you (the founder is the exception). The response is no-store and private." },
      { kind: "paragraph", text: "Separately, recordings that arrive from an approved dialer are indexed in dialer_transfers with a consent_status. The playback route at /portal/calls/recording refuses any recording whose consent is not verified, and writes that refusal to the audit log. Consent cannot be set by the sender: the ingest route deliberately omits consent_status and the recording columns from its upsert, so nobody who can push an event can mark their own call verified and unlock the audio. Verification is a human step outside the payload." },
      { kind: "heading", text: "What the platform does not hold" },
      {
        kind: "list",
        items: [
          "Caller numbers are masked. inbound_voice_calls keeps a masked caller number and a masked called number; the caller's full number exists only in the optional encrypted columns, populated only when an authorized callback workflow genuinely needs the number.",
          "There is no caller name. The Inbound page says so in the queue footer.",
          "Other members' availability is not shown to you.",
          "Missed-call counts and answer timings are not published — there is no source for them yet.",
        ],
      },
      { kind: "paragraph", text: "If something on either page reads as \"could not be read just now\" or \"not provisioned\", that is the read guard being honest about the database rather than showing you a guess. Report it; do not treat a blank as a zero." },
    ],
  },
  {
    id: "your-numbers",
    title: "Your numbers",
    summary: "How the dashboard counts your production, and what it deliberately refuses to count.",
    icon: "📊",
    status: "draft",
    provenance: "Drafted from the portal source: app/portal/page.tsx, app/portal/dashboard-data.ts, app/portal/read-guard.ts, app/portal/week.ts, app/portal/checkin/route.ts, app/portal/panel.tsx, and the state recorded in CLAUDE.md.",
    blocks: [
      { kind: "paragraph", text: "Your home page in the portal is called Your day. It shows numbers about your own work. Before you trust a figure on it, you should know where that figure comes from and what the page does when it has nothing to show. That is the subject of this document." },
      { kind: "heading", text: "What the page is made of" },
      {
        kind: "numbered",
        items: [
          { title: "Today's numbers", body: "Four small tiles across the top: Answered, Missed, Callbacks due, and Policies this week. Answered is today's count of calls you answered. Callbacks due counts the open voicemail callbacks you could pick up: the ones assigned to you, the ones you have claimed, and the ones still sitting unassigned in the shared queue. Policies this week comes from your own Book of Business. Missed has no source system at all, and the tile says so." },
          { title: "Book · next actions", body: "Cards for the things waiting on you: customers in your book whose open policies name a next action, soonest date first with undated ones last, and callbacks you owe. The first card is already open when the page loads, so you arrive at one thing to do rather than a row of closed boxes. If nothing is waiting, the page says nothing is waiting." },
          { title: "This week's production", body: "Four larger tiles — Policies sold, Calls answered, New clients, Cost per policy. Tap a tile to open Day, Week and Month views of the same metric, plus a week-over-week movement line. Down is shown in grey, not red: a slow week is not a failure." },
        ],
      },
      { kind: "heading", text: "Where the counts come from" },
      { kind: "paragraph", text: "Every production figure is computed from records the platform holds for you: calls answered, policies sold, new clients and your weekly commitment are all predicated on your own membership, and no other member's production is reachable from this page. The callback tiles and cards are the one exception, and they widen rather than narrow: they also show work sitting unassigned in the shared queue. Calls answered is the sum of the two real call stores the portal keeps — the inbound calls you accepted and answered, and the transfers recorded against your address. Policies sold and New clients read your own Book of Business entries; a policy that was declined or withdrawn does not count. Weeks run Monday to Sunday in UTC (app/portal/week.ts)." },
      { kind: "paragraph", text: "Cost per policy is pending, and it is worth understanding why. It would divide actual lead spend by policies sold, and the portal has no source for actual spend. The code in app/portal/dashboard-data.ts is explicit that it must not substitute your weekly budget instead: a plan used in place of an actual would be a fabricated number." },
      { kind: "heading", text: "The three states a figure can be in" },
      {
        kind: "list",
        items: [
          "Live — every table behind the figure was read successfully. The number shown is real, and a genuine zero is shown as zero.",
          "Pending — no source system feeds this figure yet. The tile shows a dash, and says why: \"source pending\" on the production tiles, \"Not provisioned\" with a short reason on the small tiles at the top. It is not an error, and it is not a zero.",
          "Could not be read — a table that should have answered did not. The tile shows a dash and says it could not be read just now. Nothing is lost, and nothing is wrong with your account.",
        ],
      },
      { kind: "paragraph", text: "This is enforced in one place. Every database read on this page goes through a wrapper in app/portal/read-guard.ts that catches a failure and classifies it, rather than letting an empty result stand in for a failed one. An empty list and a failed read look identical to a page, and printing \"0\" after a failed read is a false claim, not a neutral default. Where a metric adds two stores together and only one can be read, the whole metric goes to the fault state — half a sum is a confidently wrong number." },
      { kind: "heading", text: "This week's commitment" },
      { kind: "paragraph", text: "Below production is your weekly check-in. The kicker on it reads \"The plan — not the score\". You enter a lead budget for the week and a number of calls to answer. The form is plain HTML and posts to the server; your member identity and the week key are decided on the server, so there is no field through which another member's week can be named, and nothing can be back-dated. Saving again in the same week updates your plan rather than adding a second one. The check-in refuses negative numbers and anything above the caps set in app/portal/checkin/route.ts." },
      { kind: "paragraph", text: "Once set, the panel shows two goals. Calls remaining is real: your target minus the calls actually counted this week. If the call count could not be read, that bar degrades to the pending shape rather than asserting a number nobody read. Lead spend remaining is not real, and its bar is deliberately left empty with the note \"spend tracking pending\". A filled bar would assert that you have spent nothing, which the portal does not know." },
      { kind: "heading", text: "If the check-in says it is not provisioned" },
      { kind: "paragraph", text: "The weekly commitment lives in its own database table. As recorded in CLAUDE.md, that table exists in the source but had not been applied to the live database as of the date noted there. Where it has not been applied, the panel says the commitment is not provisioned instead of drawing bars, and no form is offered whose submission would have to fail. That is a deployment step for the office, not an access decision about you, and nothing about your account is missing." },
      { kind: "heading", text: "What this means when you read your numbers" },
      {
        kind: "list",
        items: [
          "A dash is not a bad week. It means no source, or no answer from the source.",
          "If you think a live figure is wrong, the question is which records it counted — not whether the page guessed.",
        ],
      },
    ],
  },
  {
    id: "asking-jarvis",
    title: "Asking J.A.R.V.I.S.",
    summary: "What the in-portal command prompt can answer, what it cannot do, and how to ask a question it can actually use.",
    icon: "J",
    status: "draft",
    provenance: "Drafted from the portal source: app/portal/presence.tsx, app/portal/presence/route.ts, app/portal/command-prompt.tsx, app/portal/components.tsx, app/portal/layout.tsx, app/portal/access.ts, app/portal/command-pass.ts, app/portal/command/, db/schema.ts, and CLAUDE.md. Status draft — not yet approved by the owner.",
    blocks: [
      { kind: "paragraph", text: "J.A.R.V.I.S. is the small assistant that lives in the corner of every portal page. You open it, you type a question, it answers in words. This document tells you where it lives, what it is allowed to do, and how to ask so you get something useful." },
      { kind: "heading", text: "The two places you can type" },
      {
        kind: "numbered",
        items: [
          { title: "The Presence panel", body: "The floating face in the corner of the portal. It is part of the portal shell, so it is on every page (app/portal/layout.tsx). Open it, type in the input, select Ask. You can drag the panel or move it with the arrow keys. Escape closes it. The panel also has a Calls tab, which is the browser phone, not J.A.R.V.I.S." },
          { title: "The command bar", body: "The sticky Command strip at the top of the shell. It is collapsed by default; the Command control in the sidebar rail and in the bottom dock open the same strip. Typing there does not ask anything. Submitting hands your draft to the Presence panel and opens it — you still have to select Ask before anything is sent (app/portal/command-prompt.tsx). The command bar renders only for the addresses on the Command Center list, so if you do not see it, use the Presence panel; it answers the same way." },
        ],
      },
      { kind: "heading", text: "What it can actually do" },
      { kind: "paragraph", text: "It answers questions about IMO and this portal in plain text, using this Library and a short description of you — your name, your role, and the capabilities your role holds. That is the whole of what it knows about you (app/portal/presence/route.ts)." },
      {
        kind: "list",
        items: [
          "Explain how something in the portal works, when the Library covers it.",
          "Tell you what your own role can and cannot open.",
          "Point you at the page or the person you need next.",
          "Quote a Library document, saying so when that document is still a draft.",
        ],
      },
      { kind: "heading", text: "What it cannot do — plainly" },
      { kind: "paragraph", text: "The model behind it is deliberately called with no tools, no function calling, and no URLs it can fetch. The route's only outbound call is to the model itself. It holds one credential, and that credential can only spend model tokens. Its entire output is a string of text that the panel renders as text." },
      { kind: "quote", text: "Nothing you type there can act on anything. The answer is words in a bubble, and that is all it is." },
      {
        kind: "list",
        items: [
          "It cannot change your book, log a policy, submit a check-in, dial, edit membership, or open a page for you. It has no write path except the audit log entry for the exchange itself.",
          "Nothing from the database is put in front of it. It does not see your numbers, your book, your calls, or the roster — its whole context is this Library plus your own name, role and capabilities.",
          "It cannot tell you anything about another member — not their role, not their results. It is instructed to refuse and it has no data to refuse from.",
          "It cannot give legal, tax, or compliance advice, quote a premium, or make a coverage promise. Those go to a human.",
          "It has no microphone. The command prompt is text only.",
          "It does not remember. The conversation lives in the open panel and dies when the page reloads.",
        ],
      },
      { kind: "paragraph", text: "If the Library does not answer your question, it is instructed to say it does not know and name who to ask, rather than invent a procedure or a figure. Treat an answer that sounds like a policy commitment as a bug and check with your upline." },
      { kind: "heading", text: "The limits you will run into" },
      {
        kind: "list",
        items: [
          "Questions are capped at 400 characters, in the command bar and at the route.",
          "Answers are capped too. If it runs out of room it says so and asks you to narrow the question — it does not quietly truncate.",
          "There is a daily number of answers per member, counted from the audit log. Past it, the Presence rests until tomorrow and tells you so.",
          "Asking requires the pet.chat capability. Every role defined in app/portal/access.ts currently holds it, but it is still checked on every request, and a suspended member gets nothing.",
          "If the key is not set on a deployment, you get an honest 503 — 'not connected yet'. It never fakes an answer.",
        ],
      },
      { kind: "paragraph", text: "Every exchange is written to the append-only audit log: your address, your role, the first part of your question, and the token usage. Every refusal is written too. Ask as if it is on the record, because it is." },
      { kind: "heading", text: "How to ask a good question" },
      {
        kind: "numbered",
        items: [
          { title: "Ask about one thing", body: "Four hundred characters and a short answer budget both reward a narrow question. 'What does my role let me open in the portal?' beats 'explain the portal'." },
          { title: "Ask about the portal or the operating model", body: "Those are the two subjects it has material for. Anything else and the honest answer is 'I don't know'." },
          { title: "Name the page", body: "If your question is about a screen, say which screen. It cannot see what you are looking at." },
          { title: "Do not ask it to do something", body: "It has no hands. Ask where the control is; then go use it." },
          { title: "Verify anything that would cost money or a commitment", body: "Pay, contracts, carrier terms, and compliance are human questions. If an answer touches one, confirm it with your upline before acting." },
        ],
      },
      { kind: "heading", text: "Not the same as the Command Center" },
      { kind: "paragraph", text: "The Command Center at /portal/command is a separate, founder-controlled area. The founder's address opens it permanently; everyone else on the Command Center list reaches it only by redeeming a single-use six-digit code the founder issued for their own address, tracked in the command_passes table (app/portal/command-pass.ts, db/schema.ts). A code is bound to one email, dies on first use, expires on its own, and locks after five wrong attempts. J.A.R.V.I.S. has nothing to do with that lock and cannot issue, redeem, or explain away a code." },
      { kind: "heading", text: "Not yet published" },
      { kind: "paragraph", text: "Nothing in the source gives J.A.R.V.I.S. access to your book, your production, the roster, or any live system, and there is no schedule published for changing that. If it ever gains one, that is a governance decision recorded by the owner, not a quiet feature. Until then, read every answer as help finding your way around — never as an authority on what you are owed or what you must do." },
    ],
  },
];
