import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

/**
 * The worker bundle targets the Cloudflare runtime, so it statically imports
 * `cloudflare:workers` — reached from db/index.ts via the portal's server-side
 * authorization module. Node's ESM loader rejects that scheme outright, which
 * kills the import before any assertion can run.
 *
 * Resolve it to a data: URL exporting an empty binding set. That is honest for
 * these tests: no D1 binding exists here, so the portal takes its fail-closed
 * path — which is precisely what the portal tests below assert.
 *
 * Only `cloudflare:workers` is stubbed. A newly-introduced `cloudflare:*`
 * import will fail loudly rather than silently resolve to an empty module.
 */
const CF_WORKERS_STUB = `data:text/javascript,${encodeURIComponent(
  "export const env = {};",
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: CF_WORKERS_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function fetchPath(pathname, headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...headers },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return fetchPath("/");
}

test("server-renders the Core operating model", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /From rented demand/);
  assert.match(html, /Five ranks/);
  assert.match(html, /Volume is noise/);
  assert.match(html, /Ember/);
  assert.match(html, /Vector/);
  assert.match(html, /Apex/);
  assert.match(html, /Dominion/);
  assert.match(html, /Zenith/);
  assert.match(html, /110%/);
  assert.match(html, /Fund a verified signal/);
  assert.match(html, /Every carrier answer/);
  assert.match(html, /Every signal becomes/);
  assert.match(html, /Find the five minutes that matter/);
  assert.match(html, /Portfolio memory gets smarter/);
  assert.match(html, /Scripts should learn/);
  assert.match(html, /N-001/);
  assert.match(html, /GOAL ENGINE/);
  assert.match(html, /J\.A\.R\.V\.I\.S\. \/ COMMAND/);
  assert.doesNotMatch(html, /Mr\. C/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
  assert.match(html, /href="\/portal"/);
});

/**
 * Portal authorization, exercised end-to-end through the built worker.
 *
 * These run with no D1 binding and no identity headers — the state a fresh
 * deployment is in before provisioning. That is the case that must not leak.
 */
/**
 * Every route that calls requireCapability. Derived by hand from the
 * requireCapability call sites and asserted to be complete below, so adding a
 * guarded page without covering it here fails the suite rather than shipping
 * unproven.
 *
 * /portal/no-access is deliberately absent: refused visitors are sent there,
 * so guarding it would redirect-loop the people it exists to explain things to.
 */
const PROTECTED_ROUTES = [
  "/go/desk",
  "/go/hq",
  "/go/routines",
  "/portal",
  "/portal/announcements",
  "/portal/audit",
  "/portal/book",
  "/portal/book/customers",
  "/portal/book/policies",
  "/portal/calls",
  "/portal/command",
  "/portal/command/cloud",
  "/portal/command/personal",
  "/portal/command/lodge",
  "/portal/calls/review",
  "/portal/calls/review/1",
  "/portal/checkin",
  "/portal/commission",
  "/portal/dialer",
  "/portal/gallery",
  "/portal/commission/document",
  "/portal/investigator",
  "/portal/inbound",
  "/portal/leadership",
  "/portal/leaderboard",
  "/portal/leadtech",
  "/portal/library",
  "/portal/retreaver",
  "/portal/stats",
  "/portal/tools",
  "/portal/twilio",
  "/portal/members",
  "/portal/pay-rates",
  "/portal/music",
  "/portal/quoter",
  "/portal/scripts",
  "/portal/shop",
  "/portal/team",
  "/portal/training",
  "/portal/usage",
].map((pathname) => [pathname, encodeURIComponent(pathname)]);

test("protected portal routes refuse anonymous visitors and render nothing", async () => {
  for (const [pathname, encodedReturn] of PROTECTED_ROUTES) {
    const response = await fetchPath(pathname);

    assert.equal(response.status, 307, `${pathname} must redirect, not render`);

    const location = response.headers.get("location") ?? "";
    assert.match(
      location,
      /\/auth\/signin\?/,
      `${pathname} must route to sign-in, got ${location}`,
    );
    assert.ok(
      location.includes(`return_to=${encodedReturn}`),
      `${pathname} must preserve its own return path, got ${location}`,
    );

    const body = await response.text();
    assert.equal(body, "", `${pathname} must not emit a response body`);
  }
});

test("the no-access page renders without authentication", async () => {
  // Refused visitors are sent here, so it must never guard itself — doing so
  // would redirect-loop the people it exists to explain things to.
  const response = await fetchPath("/portal/no-access");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Sign in required/);
  assert.doesNotMatch(html, /Capabilities held/);
});

/**
 * Guards the guard list. If someone adds a page that calls requireCapability
 * and forgets PROTECTED_ROUTES, this fails — which is the only thing standing
 * between a new guarded page and shipping with no anonymous-refusal proof.
 */
test("every guarded route is covered by the anonymous-refusal list", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const { fileURLToPath } = await import("node:url");
  const appDir = fileURLToPath(new URL("../app", import.meta.url));

  // Second argument of requireCapability(capability, returnTo) is the route;
  // requireFounder(returnTo) and requireCommandCenter(returnTo) take the
  // route directly. All three are guards, and a page shipping behind any of
  // them without an anonymous-refusal test is the same failure — the regex
  // must see them all.
  const GUARD =
    /(?:requireCapability\(\s*"[^"]+"\s*,|requireFounder\(|requireCommandCenter\()\s*"([^"]+)"/g;

  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx" || entry === "route.ts") {
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(GUARD)) found.add(m[1]);
      }
    }
  };
  walk(appDir);

  const covered = new Set(PROTECTED_ROUTES.map(([p]) => p));
  const uncovered = [...found].filter((p) => !covered.has(p)).sort();

  assert.deepEqual(
    uncovered,
    [],
    `guarded but untested: ${uncovered.join(", ")} — add them to PROTECTED_ROUTES`,
  );
  assert.ok(found.size >= 10, `expected at least 10 guarded routes, found ${found.size}`);

  // The regex above only understands double-quoted route literals. A guard
  // call it cannot parse (e.g. a template-literal returnTo on a dynamic [id]
  // page) would silently fall out of the completeness net — so any page that
  // *calls* a guard but yielded no match must fail loudly here instead.
  const unparseable = [];
  const check = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) check(full);
      else if (entry === "page.tsx" || entry === "route.ts") {
        const src = readFileSync(full, "utf8");
        const calls = (
          src.match(/requireCapability\(|requireFounder\(|requireCommandCenter\(/g) ?? []
        ).length;
        const matched = [...src.matchAll(GUARD)].length;
        if (calls > matched) {
          // Allow template-literal returnTo ONLY when the route's static
          // prefix is itself covered by a PROTECTED_ROUTES entry.
          const templated = [...src.matchAll(
            /(?:requireCapability\(\s*"[^"]+"\s*,|requireFounder\()\s*`([^`$]+)/g,
          )].map((m) => m[1]);
          const prefixCovered = templated.length === calls - matched
            && templated.every((prefix) =>
              PROTECTED_ROUTES.some(([p]) => p.startsWith(prefix)));
          if (!prefixCovered) unparseable.push(relativeApp(full));
        }
      }
    }
  };
  const relativeApp = (p) => p.slice(p.indexOf("app"));
  check(appDir);
  assert.deepEqual(
    unparseable,
    [],
    `guard calls the completeness scanner cannot verify: ${unparseable.join(", ")} — use a parseable returnTo or add the route to PROTECTED_ROUTES`,
  );
});

/**
 * T4-1, the OTHER direction. The scanner above is guard-first: it collects
 * routes that *call* a guard and proves each is tested. A page that calls NO
 * guard at all yields no match, adds nothing to `found`, and passes the
 * loud-fail check too (calls > matched is 0 > 0) — so an unguarded portal page
 * was invisible to the entire suite. This net runs the opposite way: every
 * page under app/portal must call a guard, or name itself as a deliberate
 * exception here.
 */
test("every portal page calls a guard — no page ships unguarded", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const portalDir = fileURLToPath(new URL("../app/portal", import.meta.url));

  // Deliberate, reasoned exceptions. Adding to this list is a governance act:
  // each entry states why the page is safe to serve without a guard.
  const UNGUARDED_BY_DESIGN = new Map([
    // Refused visitors land here; guarding it would redirect-loop the people
    // it exists to explain things to.
    ["app/portal/no-access/page.tsx", "landing page for refused visitors"],
  ]);

  const unguarded = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const rel = full.slice(full.indexOf("app")).split("\\").join("/");
        if (UNGUARDED_BY_DESIGN.has(rel)) continue;
        const src = readFileSync(full, "utf8");
        if (!/requireCapability\(|requireFounder\(|requireCommandCenter\(/.test(src)) {
          unguarded.push(rel);
        }
      }
    }
  };
  walk(portalDir);

  assert.deepEqual(
    unguarded.sort(),
    [],
    `portal pages that call no guard: ${unguarded.join(", ")} — add requireCapability/requireFounder, or justify it in UNGUARDED_BY_DESIGN`,
  );
});

/**
 * A8-1. FOUNDER_EMAILS is the sole gate on /portal/audit, /portal/investigator,
 * and every /go/* handoff — identity, not capability, so no role grant can
 * widen it and no test of roles can narrow it. (/portal/command moved to the
 * COMMAND_CENTER_EMAILS gate by founder order 2026-08-17 — pinned in the next
 * test.) The runtime suite proves specific addresses are refused; this pins
 * the SET ITSELF, so that quietly adding a second founder fails here rather
 * than shipping.
 */
test("FOUNDER_EMAILS holds exactly one identity", async () => {
  const source = await readFile(
    new URL("../app/portal/access.ts", import.meta.url),
    "utf8",
  );

  const declaration = source.match(
    /FOUNDER_EMAILS[^=]*=\s*new Set\(\[([^\]]*)\]\)/,
  );
  assert.ok(declaration, "FOUNDER_EMAILS must be a literal Set — keep it greppable");

  const addresses = [...declaration[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  assert.deepEqual(
    addresses,
    ["btcmao518@gmail.com"],
    "FOUNDER_EMAILS changed — adding a founder is a governance decision (A2/A9), not a code change",
  );
});

/**
 * COMMAND_CENTER_EMAILS is the founder plus individually NAMED helpers, each
 * added by an explicit founder order. Pinning the exact contents means a
 * quiet addition fails here rather than shipping — widening this set is a
 * governance decision, not a code change. Andrew Davidson was added by
 * founder order 2026-08-17 ("unlock COMMAND CENTER for ANDREW DAVIDSON"),
 * scope: the Command Center page only.
 */
test("COMMAND_CENTER_EMAILS holds exactly the founder and Andrew Davidson", async () => {
  const source = await readFile(
    new URL("../app/portal/access.ts", import.meta.url),
    "utf8",
  );

  const declaration = source.match(
    /COMMAND_CENTER_EMAILS[^=]*=\s*new Set\(\[([^\]]*)\]\)/,
  );
  assert.ok(
    declaration,
    "COMMAND_CENTER_EMAILS must be a literal Set spreading FOUNDER_EMAILS — keep it greppable",
  );

  // Exactly ONE spread, and it is FOUNDER_EMAILS — a second spread would
  // widen the set without appearing in the quoted-literal check below.
  const spreads = [...declaration[1].matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.deepEqual(
    spreads,
    ["FOUNDER_EMAILS"],
    "COMMAND_CENTER_EMAILS must spread FOUNDER_EMAILS and nothing else",
  );

  // Both quote styles and template literals count as literals here, so a
  // single-quoted addition cannot dodge the pin; a template literal has no
  // legitimate reason to exist in this Set and fails the exact-match below.
  const addresses = [...declaration[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  assert.deepEqual(
    addresses,
    ["andrew.davidson.zenith@gmail.com"],
    "COMMAND_CENTER_EMAILS changed — a named helper is added only by founder order, recorded in OWNER-DECISIONS.md",
  );
});

test("every portal page except no-access declares exactly one server guard", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const portalDir = fileURLToPath(new URL("../app/portal", import.meta.url));
  const failures = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "page.tsx") {
        const routeFile = relative(portalDir, full).replaceAll("\\", "/");
        if (routeFile === "no-access/page.tsx") continue;
        const source = readFileSync(full, "utf8");
        const guards =
          source.match(/requireCapability\(|requireFounder\(|requireCommandCenter\(/g) ?? [];
        if (guards.length !== 1) failures.push(`${routeFile} (${guards.length} guards)`);
      }
    }
  };
  walk(portalDir);

  assert.deepEqual(
    failures,
    [],
    `portal pages missing one unambiguous guard: ${failures.join(", ")}`,
  );
});

test("Personal Command stays behind the founder identity gate and its launcher matches that boundary", async () => {
  const page = await readFile(
    new URL("../app/portal/command/personal/page.tsx", import.meta.url),
    "utf8",
  );
  const command = await readFile(
    new URL("../app/portal/command/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /export const revalidate = 0/);
  assert.match(
    page,
    /requireFounder\(\s*"\/portal\/command\/personal"\s*,\s*"command\.personal\.view"\s*,?\s*\)/,
    "the personal room must use the founder identity gate and its truthful audit action",
  );
  assert.doesNotMatch(page, /requireCommandCenter\(/);
  assert.doesNotMatch(page, /requireCapability\(/);
  assert.doesNotMatch(page, /^\s*["']use client["'];?/m);
  assert.match(page, /data-private-surface="command-personal-v1"/);
  assert.match(page, /Your command,/);
  assert.match(page, /Ten-seat fleet/);
  assert.doesNotMatch(
    page,
    /@inkboxmail\.com|@pm\.me|\+1\s*\(\d{3}\)/,
    "snapshot contact details must not be copied into the Personal Command source",
  );

  assert.match(
    command,
    /const founder = isFounder\(session\)/,
    "the launcher must derive visibility from the founder identity, not a role or lodge state",
  );
  assert.match(
    command,
    /\{founder \? \([\s\S]*?href="\/portal\/command\/personal"[\s\S]*?<strong>Personal Command<\/strong>[\s\S]*?\) : null\}/,
    "only the founder should receive the Personal Command launcher link",
  );
});

test("Founder shortcuts are deliberate anchors, never prefetched redirect handlers", async () => {
  const source = await readFile(
    new URL("../app/portal/command/page.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  // Next Link may prefetch a route handler before the founder taps it. These
  // handlers audit access and, for HQ and Desk, leave the portal, so every
  // /go/* launch must remain an ordinary anchor with browser-default timing.
  assert.match(
    source,
    /<a\s+className=\{`fcc-launch[\s\S]*?href=\{handoff\.route\}/,
    "the launcher no longer uses a plain anchor for /go/* handoffs",
  );
  for (const route of ["hq", "routines", "desk"]) {
    assert.match(
      source,
      new RegExp(`<a href="/go/${route}">`),
      `the thumb launcher no longer uses a plain anchor for /go/${route}`,
    );
  }
  assert.doesNotMatch(
    source,
    /<Link[^>]*(?:href=\{handoff\.route\}|href="\/go\/)/,
    "a /go/* redirect handler can be prefetched again",
  );
  assert.match(
    css,
    /\.fcc-hero \.fcc-source \{ color: #f4ead7; \}/,
    "the hero provenance text lost its high-contrast foreground",
  );
  assert.match(
    css,
    /\.portal:has\(\.fcc-thumb-dock\) > \.presence \{\s*bottom: calc\(148px \+ env\(safe-area-inset-bottom\)\);\s*\}/,
    "the shipped Presence overlaps the Command Center's mobile thumb dock",
  );
});

test("Training is guarded, ordered at the top of Work, and stays server-only", async () => {
  const navigation = await readFile(
    new URL("../app/portal/components.tsx", import.meta.url),
    "utf8",
  );
  const page = await readFile(
    new URL("../app/portal/training/page.tsx", import.meta.url),
    "utf8",
  );
  const library = await readFile(
    new URL("../app/portal/training/library.ts", import.meta.url),
    "utf8",
  );

  // The order pin has moved twice, and says so each time. It first read
  // "Training above Book of Business", then "Training above Calls" when the
  // 2026-09-02 consolidation put both in one Work group. The five-group IA
  // (work order 1A, same day) puts Calls in Today and Training in Selling, so
  // the two are no longer in one group and their relative array position
  // means nothing. Re-anchored, not deleted: Training must still exist in NAV,
  // must be assigned to Selling, and must be the FIRST row of Selling — above
  // the Script Vault — so it stays the first thing an agent sees when they
  // open the group they train in.
  const trainingNav = navigation.indexOf('href: "/portal/training"');
  const scriptsNav = navigation.indexOf('href: "/portal/scripts"');
  assert.ok(trainingNav >= 0, "Training is missing from portal navigation");
  assert.ok(scriptsNav >= 0, "Script Vault is missing from portal navigation");
  assert.ok(trainingNav < scriptsNav, "Training must stay the first row of Selling, above the Script Vault");
  assert.match(
    navigation.slice(trainingNav, scriptsNav),
    /group: "Selling"/,
    "Training must be assigned to the Selling group",
  );
  assert.match(
    page,
    /requireCapability\("dashboard\.view\.self", "\/portal\/training"\)/,
    "Training lost its literal server-side guard",
  );
  assert.doesNotMatch(
    `${page}\n${library}`,
    /^["']use client["'];/m,
    "approved training language moved into a public client module",
  );
  // The body flows VERBATIM into the presentation-only ScriptBody component
  // (owner order 2026-08-18: highlight the spoken lines). The component may
  // wrap substrings in styling elements but must never alter the text — a
  // runtime test in portal-authorization extracts the rendered <pre>'s text
  // content and compares it byte-for-byte against the approved constant,
  // which is the stronger, output-level form of the direct-render pin that
  // used to live here.
  //
  // The body now reaches ScriptBody through splitApprovedBody, which cuts it
  // into the author's own sections so an agent can work a step at a time on a
  // live call. That is a split, never a rewrite, and it is pinned three ways
  // rather than one:
  //   1. the only thing handed to the splitter is slot.body itself,
  //   2. the only thing handed to the renderer is a snippet of that split,
  //   3. the splitter refuses to return a split that does not rejoin to its
  //      input exactly — asserted here at the source, so the guarantee cannot
  //      be quietly deleted from library.ts.
  // The output-level proof still lives in portal-authorization, and it grew
  // with this change: it concatenates EVERY rendered snippet and compares the
  // result byte-for-byte to the approved constant, so a dropped, duplicated,
  // or reordered section now fails too.
  assert.match(
    page,
    /splitApprovedBody\(slot\.body\)/,
    "the approved body is no longer what gets split",
  );
  assert.match(
    page,
    /<ScriptBody body=\{snippet\.text\} \/>/,
    "approved training text no longer flows verbatim into the script renderer",
  );
  assert.match(
    library,
    /if \(rejoined !== body\) \{\n\s*throw new Error/,
    "splitApprovedBody no longer refuses a lossy split",
  );
  assert.doesNotMatch(
    page,
    /slot\.body\.(?:trim|replace|slice|substring)|marked\(|dangerouslySetInnerHTML/,
    "approved training text is transformed before rendering",
  );
  assert.doesNotMatch(
    `${page}\n${library}`,
    /snippet\.text\.(?:trim|replace|slice|substring)/,
    "a snippet is transformed after the split",
  );
});

test("every approved Training body remains byte-verbatim", async () => {
  // These are the words agents read to real clients on recorded calls. The
  // library's own rule is that J.A.R.V.I.S. may arrange and render them but
  // must never write, rewrite, shorten or complete them — and a rule nothing
  // measures is a preference. This is the measurement.
  //
  // It pins EVERY approved body, not just the first one. The earlier version
  // pinned one and asserted "exactly one is loaded", which was fine while one
  // was true and would have quietly let the second through as soon as it was
  // not. The check below inverts that: an approved body with no pin entry is
  // a FAILURE, so adding a script without recording its bytes is impossible
  // rather than merely discouraged.
  const library = await readFile(
    new URL("../app/portal/training/library.ts", import.meta.url),
    "utf8",
  );

  const PINS = {
    DIRECT_CARRIER_QUESTION_INTRO_BODY: {
      bytes: 3765,
      newlines: 130,
      sha256: "04740e30b911a5da2c1435eae4f5f0eb11e085d73b4db8448810bde3c92b89d8",
    },
    CLIENT_STATES_PROBLEM_FIRST_BODY: {
      bytes: 2079,
      newlines: 60,
      sha256: "5b2d79935cfe93d8177414b689f3e73d618057243ba398868556b3d9a647bac5",
    },
    DEATH_CLAIM_DISCOVERY_INTRO_BODY: {
      bytes: 2935,
      newlines: 77,
      sha256: "7ae9c0f67482d0d51a5c7e7f76679e2ccdb8f50d95221f2933e4e92210526f24",
    },
    CANCELATION_INTRO_BODY: {
      bytes: 2601,
      newlines: 80,
      sha256: "4c3dd3c41c8aaee9d87aaee925d30a96405a1b4c9f251a6010e774f76867e7b5",
    },
    STANDARD_TO_PREFERRED_BODY: {
      bytes: 3423,
      newlines: 62,
      sha256: "d3eff3b91f6396d5465c0bffddc72dcc4bc30ef36f61789ccdc2c28e96583785",
    },
    TERM_TO_PERM_BODY: {
      bytes: 4326,
      newlines: 86,
      sha256: "be3d65b662ab764cab66c13b9c5eed62b0bd41dc81b74b07e371e88cfbf170d7",
    },
    CASH_SURRENDER_BODY: {
      bytes: 4481,
      newlines: 87,
      sha256: "91bef711bd1632c516e7adec1d6b155264d2233ca0fb18f584cae50276561210",
    },
    LOAN_FORGIVENESS_BODY: {
      bytes: 4335,
      newlines: 86,
      sha256: "3da4aa90ec0d256780cf0bedb0b3c489c005f84fd6aa0a25cf4f371383467c0c",
    },
    DEATH_CLAIM_EXTENSION_BODY: {
      bytes: 5037,
      newlines: 105,
      sha256: "152b02038555be4b1aed158212fc638005d3f18e927c91c666e88469633fa5c9",
    },
    NON_LIFE_EXTENSION_BODY: {
      bytes: 4624,
      newlines: 89,
      sha256: "848395da4b8224fe852de21895603d17ca81d4059f31dd626b3d7201db847aa5",
    },
    CONSOLIDATION_BODY: {
      bytes: 3966,
      newlines: 76,
      sha256: "bba28d7eb7315fc068e0b0c74269a283e7eb5b5a17e98ceda467acc76884b074",
    },
    WORK_POLICY_BODY: {
      bytes: 3296,
      newlines: 78,
      sha256: "fb093c7bb9c9623d221b07f1ed36cbaccd661ee5ee64d82e951f29c5d02364fc",
    },
    QUOTE_SHOPPER_ANGLE_BODY: {
      bytes: 2920,
      newlines: 56,
      sha256: "7531e3ced3735025f85db4ffa888f863ec62c274fb7d27db269fde03e723b46a",
    },
    THREE_OPTION_CLOSE_BODY: {
      bytes: 1934,
      newlines: 57,
      sha256: "8c8176cce32d6f08d91be10353dc625f7f2b92230167e0501e7af8990f8ad557",
    },
    BILLING_PAGE_BODY: {
      bytes: 2153,
      newlines: 54,
      sha256: "e43659bd847c3bd81d65e05830a3e6886b95fe586e8c4cafa4227bebbfa79ba6",
    },
  };

  // Discover what the file actually declares, rather than trusting the table
  // to be the complete list. This is the half that makes an unpinned body
  // impossible: a new `*_BODY` constant appears here whether or not anyone
  // remembered to add a pin.
  const declared = [...library.matchAll(/^export const (\w+_BODY) = (".*");$/gm)];

  // PENDING STATE — the IMO changeover, 2026-08-26. The approved bodies were
  // unpublished with the rest of the previous operator's content, so the file
  // declares none. The PINS table above is deliberately KEPT rather than
  // deleted: it is the byte record of what the approved language was, and it
  // is what makes a restoration from `backup/thrive-content-2026-08-26`
  // verifiable rather than merely plausible. Restore the content and every
  // assertion below wakes up and enforces those exact bytes again.
  //
  // The empty case is asserted, never assumed. A library with no bodies but a
  // slot still marked approved is the dangerous shape — an inline string
  // rendering as approved language outside every check here — so that is
  // exactly what this branch refuses.
  if (declared.length === 0) {
    // Comma, not semicolon: `state: "approved";` is the ApprovedTrainingSlot
    // type declaration and must survive an empty library. Only a slot literal
    // — `state: "approved",` — is the shape this guards against.
    const approvedWhileEmpty = [...library.matchAll(/state: "approved",/g)];
    assert.equal(
      approvedWhileEmpty.length,
      0,
      "the library declares no approved bodies, yet a slot is still marked approved",
    );
    assert.ok(
      Object.keys(PINS).length > 0,
      "the PINS table was emptied — the restoration baseline for the approved language is gone",
    );
    return;
  }

  assert.deepEqual(
    declared.map(([, name]) => name).sort(),
    Object.keys(PINS).sort(),
    "every exported script body must carry a pin, and every pin must name a real body",
  );

  for (const [, name, literal] of declared) {
    const body = JSON.parse(literal);
    const pin = PINS[name];
    assert.equal(Buffer.byteLength(body, "utf8"), pin.bytes, `${name} byte length changed`);
    assert.equal((body.match(/\n/g) ?? []).length, pin.newlines, `${name} line count changed`);
    assert.equal(
      createHash("sha256").update(body, "utf8").digest("hex"),
      pin.sha256,
      `${name} was edited — approved language may not be changed without a founder decision`,
    );
  }

  // A slot may not be marked approved while pointing at anything other than
  // one of the pinned constants. Otherwise an inline body string would render
  // as approved language while sitting outside every check above.
  const approved = [...library.matchAll(/state: "approved",\n    body: (\w+),/g)].map(
    ([, ref]) => ref,
  );
  assert.equal(
    approved.length,
    declared.length,
    "the number of approved slots must equal the number of pinned bodies",
  );
  for (const ref of approved) {
    assert.ok(ref in PINS, `an approved slot points at ${ref}, which carries no pin`);
  }
});

test("the supervised preview remains a Vite-native, allowlisted server", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const viteConfig = await readFile(
    new URL("../vite.config.ts", import.meta.url),
    "utf8",
  );

  assert.equal(packageJson.scripts.dev, "vite");
  assert.doesNotMatch(
    viteConfig,
    /host:\s*["']0\.0\.0\.0["']/,
    "ordinary local dev must not persist an all-interface listener",
  );
  assert.match(viteConfig, /allowedHosts:\s*\["terminal\.local"\]/);
  assert.match(viteConfig, /vinext\(\)/, "the Vinext Vite plugin was removed");
  assert.match(
    viteConfig,
    /isCodexSeatbeltSandbox[\s\S]*?useFsEvents:\s*false[\s\S]*?usePolling:\s*true/,
    "the Seatbelt polling fallback was removed",
  );
});

test("the portal error boundary stays sanitized and client-safe", async () => {
  // No integration path triggers the boundary deterministically (read-guard
  // swallows D1 faults by design), so pin the source the way the sw.js test
  // does: the properties that make it safe must survive edits literally.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(
    fileURLToPath(new URL("../app/portal/error.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(src, /^"use client";/, "the boundary must be a client component");
  assert.doesNotMatch(
    src,
    /from\s+["'][^"']*\/access["']/,
    "the boundary must never import the server-only access module",
  );
  assert.match(src, /error\.digest/, "the boundary renders the sanitized digest");
  // error.message may appear only inside the console.error fallback — never
  // in JSX. Strip the logging line, then require the rendered tree clean.
  const withoutLogging = src
    .split("\n")
    .filter((line) => !line.includes("console.error"))
    .join("\n");
  assert.doesNotMatch(
    withoutLogging,
    /\{[^}]*error\.(message|stack)[^}]*\}/,
    "raw error text must never be interpolated into the rendered tree",
  );
});

/**
 * The public surfaces. These must render for anyone — they are how a recruit
 * or a locked-out member finds out what to do next — and must never contain
 * member data.
 */
const PUBLIC_ROUTES = ["/", "/access", "/tour"];

test("public surfaces render for anonymous visitors", async () => {
  for (const pathname of PUBLIC_ROUTES) {
    const response = await fetchPath(pathname);
    assert.equal(response.status, 200, `${pathname} must render publicly`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

    const html = await response.text();
    assert.ok(html.length > 500, `${pathname} rendered an empty page`);
    // Rebranded to the IMO Operating Portal 2026-08-26. The assertion is kept
    // rather than dropped: its job is to catch a page that renders chrome-less
    // or unbranded, and that job did not go away with the wordmark.
    assert.match(html, /IMO/, `${pathname} must carry IMO branding`);
    // Theme control must exist on every public page, or Bright/Dark is
    // unreachable there.
    assert.match(
      html,
      /portal-theme-control/,
      `${pathname} is missing the Bright/Dark control`,
    );
  }
});

test("the access page never reveals whether an address holds membership", async () => {
  // The seeded owner address and an address that cannot be a member must
  // produce identical pages apart from the echoed text itself. Any divergence
  // would make this page an enumeration oracle.
  // Deliberately synthetic. A real member address must never be written into
  // the repository: git history is irretractable, and this test does not need
  // one -- it proves the response shape does not vary with the input at all.
  const first = await fetchPath("/access?email=someone%40example.com");
  const second = await fetchPath("/access?email=nobody%40example.invalid");

  assert.equal(first.status, second.status);

  const a = (await first.text()).replaceAll("someone@example.com", "X");
  const b = (await second.text()).replaceAll("nobody@example.invalid", "X");

  assert.equal(a, b, "access page output differs by address — enumeration oracle");
});

test("public surfaces carry no member or audit data", async () => {
  for (const pathname of PUBLIC_ROUTES) {
    const html = await (await fetchPath(pathname)).text();
    for (const marker of ["portal_members", "audit_events", "subject_id", "last_seen_at"]) {
      assert.doesNotMatch(
        html,
        new RegExp(marker),
        `${pathname} leaked the marker ${marker}`,
      );
    }
  }
});

/* ============================================================
   Installable app (PWA)
   ============================================================ */

/**
 * The theme system: three named themes (bright / dark / thrive), declared in
 * TWO places that must not drift — the THEMES table in theme-control.tsx and
 * the pre-paint boot script in portal-chrome.tsx (inlined because it runs
 * before React). Both must validate stored values against the same set and
 * fall back to the same default (dark): if their fallbacks disagree, a junk
 * stored value makes aria-pressed lie about the active theme. The chrome
 * (theme-color) hexes must also match, or the phone status bar flickers
 * between boot and first toggle.
 */
test("the theme boot script and the theme control agree on the three themes", async () => {
  const boot = await readFile(new URL("../app/portal-chrome.tsx", import.meta.url), "utf8");
  const control = await readFile(new URL("../app/theme-control.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  // Boot: explicit whitelist with THRIVE fallback — not a two-value ternary.
  // Thrive became the default on the founder's order 2026-08-18 ("DO NOT TAKE
  // THRIVE COLOR OUT. THAT'LL BE THE DEFAULT COLOR WHILE STILL HAVING BRIGHT
  // AND DARK"). All three remain selectable; only the unset case moved.
  assert.match(
    boot,
    /\(t==="bright"\|\|t==="dark"\)\?t:"thrive"/,
    "the boot script must whitelist exactly bright|dark and fall back to thrive",
  );

  // Control: the THEMES table carries exactly the same ids. Its readTheme
  // fallback is BRIGHT on purpose — it describes what the DOM shows, and a
  // missing attribute means the boot never ran, so the unguarded base
  // (Bright) palette is on screen. The boot's own fallback stays dark.
  const ids = [...control.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["bright", "dark", "thrive"], "THEMES table ids changed");
  assert.match(
    control,
    /return known \? known\.id : "bright";/,
    "readTheme's missing-attribute fallback must describe the DOM's Bright base",
  );
  assert.match(
    control,
    /useSyncExternalStore\(subscribe, readTheme, \(\) => "thrive"\)/,
    "the server snapshot must match the boot script's thrive default",
  );

  // Chrome hexes: the same three values in both files. Thrive's chrome is
  // its LIGHT workspace hex — on phones the status bar sits above the white
  // topbar, not the navy rail.
  for (const chrome of ["#f3ecdf", "#0b130f", "#eef2f9"]) {
    assert.ok(boot.includes(chrome), `boot script lost the ${chrome} chrome hex`);
    assert.ok(control.includes(chrome), `THEMES table lost the ${chrome} chrome hex`);
  }

  // The stylesheet actually defines the third skin — token block and the
  // navy menu/dock chrome scope both present.
  assert.match(css, /html\[data-portal-theme="thrive"\] \.portal \{/);
  assert.match(css, /html\[data-portal-theme="thrive"\] \.portal \.portal-rail \{/);
  // Every custom property the dark block overrides has a thrive counterpart
  // on the main scope — a partial skin silently inherits parchment values.
  const blockOf = (marker) => {
    const start = css.indexOf(marker);
    assert.ok(start >= 0, `missing block ${marker}`);
    return css.slice(start, css.indexOf("}", start));
  };
  // Colon-anchored on purpose: --portal-accent is a substring of
  // --portal-accent-strong, so a bare includes() would let a block that only
  // defines the -strong variant pass.
  const darkTokens = [...blockOf('html[data-portal-theme="dark"] .portal {').matchAll(/--portal-[\w-]+(?=:)/g)].map((m) => m[0]);
  const thriveBlock = blockOf('html[data-portal-theme="thrive"] .portal {');
  const missing = [...new Set(darkTokens)].filter((token) => !thriveBlock.includes(`${token}:`));
  assert.deepEqual(missing, [], `thrive theme lacks tokens the dark theme defines: ${missing.join(", ")}`);

  // The boot mirrors ids and chrome hexes from the THEMES table but derives
  // color-scheme from a hardcoded ternary — pin that ternary AND the table's
  // scheme column, so a future dark-scheme theme cannot silently boot light.
  assert.match(boot, /colorScheme=v==="dark"\?"dark":"light"/, "boot color-scheme mapping changed");
  const schemes = [...control.matchAll(/scheme: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(schemes, ["light", "dark", "light"], "THEMES scheme column changed — update the boot's colorScheme mapping with it");

  // The storage key is duplicated by hand in both files (the boot cannot
  // import). A mismatch is total theme amnesia, worse than any drift above.
  assert.match(boot, /PORTAL_THEME_STORAGE_KEY = "core-portal-theme"/);
  assert.match(control, /const STORAGE_KEY = "core-portal-theme"/);
});

test("public surfaces offer all three theme choices", async () => {
  const response = await fetchPath("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  // "Thrive" became "Blue" on the founder's word 2026-08-26, palette untouched.
  // The ids are asserted separately above and deliberately did NOT change:
  // `thrive` is still the stored value and the CSS selector key.
  for (const label of ["Bright", "Dark", "Blue"]) {
    assert.match(
      html,
      new RegExp(`portal-theme-label">${label}`),
      `the theme control is missing the ${label} option`,
    );
  }
});

test("serves a web app manifest that installs to the portal", async () => {
  const response = await fetchPath("/manifest.webmanifest", { accept: "*/*" });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/manifest\+json/i,
    "a manifest served as anything else is ignored by the installer",
  );

  const manifest = JSON.parse(await response.text());
  assert.equal(manifest.start_url, "/portal");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.id, "/portal");

  // Android's installer refuses without a 192 and a 512, and crops the icon to
  // the launcher's shape unless a maskable one exists.
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "no 192px icon — Android will not install");
  assert.ok(sizes.includes("512x512"), "no 512px icon — Android will not install");
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === "maskable"),
    "no maskable icon — the mark gets clipped by the launcher mask",
  );
});

test("the installable shell is declared in the document head", async () => {
  const html = await (await render()).text();
  assert.match(html, /rel="manifest"/, "no manifest link — nothing is installable");
  assert.match(
    html,
    /rel="apple-touch-icon"[^>]*apple-touch-icon\.png/,
    "iOS ignores the SVG icon and screenshots the page instead",
  );
  assert.match(
    html,
    /name="apple-mobile-web-app-capable"/,
    "iOS before 16.4 will not launch standalone without the apple- prefixed name",
  );
  assert.match(html, /name="theme-color"/);
  // Pinned because viewport-fit rides on the `width` field — see app/layout.tsx.
  // Exactly one viewport meta, and it must carry the directive.
  const viewports = html.match(/<meta name="viewport"[^>]*>/g) ?? [];
  assert.equal(viewports.length, 1, "duplicate viewport meta tags");
  assert.match(viewports[0], /width=device-width/);
  assert.match(viewports[0], /viewport-fit=cover/);
  assert.match(html, /serviceWorker/, "the service worker is never registered");
});

test("the service worker never caches an authenticated response", async () => {
  // The whole access model is server-side. A cached /portal page would answer
  // without re-resolving the session cookie or the member's row, so a signed-out
  // or suspended device would keep serving whatever it last saw. This asserts
  // the source of that guarantee rather than its effect, because a service
  // worker cannot be exercised from Node.
  // Normalised to LF before anything else. Development happens on Windows,
  // where git checks this file out with CRLF — and the byte-pinned comparison
  // below must judge the code, not the checkout configuration. Without this,
  // the end-of-branch marker ("\n  }\n") never matches on Windows, the slice
  // runs to the end of the file, and the suite fails on a service worker that
  // is completely correct. It blocked the owner's first gated deploy.
  const source = (
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");

  assert.match(
    source,
    /url\.pathname === "\/portal" \|\| url\.pathname\.startsWith\("\/portal\/"\)/,
    "the /portal exclusion is gone — authenticated pages are now cacheable",
  );
  assert.match(
    source,
    /url\.pathname\.startsWith\("\/auth\/"\)/,
    "the /auth exclusion is gone — sign-in and callback responses are cacheable",
  );
  // A /portal navigation may be intercepted to serve the static offline page on
  // a network failure — the installed app starts at /portal, so that is the
  // likeliest offline moment. It must remain a bare pass-through: no cache read
  // and no cache write on that path.
  /**
   * Pinned positively rather than by forbidding things. An earlier version of
   * this check listed what the branch must not contain, and a mutation that
   * swapped the pass-through for `cacheFirst(request, STATIC_CACHE)` — which
   * would serve a member a cached portal page — walked straight through it.
   * Enumerating the ways to be wrong does not work; stating the one acceptable
   * body does.
   */
  const branchStart = source.indexOf("const isPortal");
  assert.ok(branchStart > 0, "could not locate the /portal branch — this check went stale");
  const portalBranch = source.slice(branchStart, source.indexOf("\n  }\n", branchStart));

  const normalised = portalBranch
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  assert.equal(
    normalised,
    'const isPortal = url.pathname === "/portal" || url.pathname.startsWith("/portal/"); ' +
      'if (isPortal || url.pathname.startsWith("/auth/")) { ' +
      'if (isPortal && request.mode === "navigate") { ' +
      "event.respondWith(fetch(request).catch(offlinePage)); } return;",
    "the /portal and /auth branch changed. This is the access boundary in the service worker: " +
      "only a navigation may be intercepted, only to fall back to the static offline page when the " +
      "network fails, and nothing here may read or write a cache. If the change is intended, " +
      "re-read what it does to a suspended member's installed app before updating this string.",
  );
  assert.match(
    source,
    /request\.method !== "GET"/,
    "non-GET requests are no longer passed straight through",
  );

  // /go/* contains founder-gated redirect decisions. It must remain outside
  // both cacheable allowlists: a cached redirect could outlive founder access
  // or a later destination correction without re-running requireFounder.
  const precacheStart = source.indexOf("const PRECACHE = [");
  const precacheEnd = source.indexOf("];", precacheStart);
  assert.ok(precacheStart > 0 && precacheEnd > precacheStart, "could not locate PRECACHE");
  const precache = source.slice(precacheStart, precacheEnd + 2);
  assert.doesNotMatch(precache, /["'`]\/go(?:\/|["'`])/, "/go/* entered PRECACHE");
  assert.match(
    source,
    /function isImmutableAsset\(url\) \{\s*return url\.pathname\.startsWith\("\/assets\/"\);\s*\}/,
    "the immutable-asset rule widened beyond content-hashed /assets files",
  );
  assert.match(
    source,
    /function isStaticFile\(url\) \{\s*return PRECACHE\.includes\(url\.pathname\);\s*\}/,
    "the static-file cache rule no longer delegates exclusively to PRECACHE",
  );

  // Only these two caches may exist, and only these two rules may write to one.
  const writes = source.match(/cache\.put\(/g) ?? [];
  assert.equal(writes.length, 2, "a new cache write appeared — check what it stores");
});

test("restricted data never reaches a public client chunk", async () => {
  /**
   * Static assets under /assets are served by the ASSETS binding without ever
   * touching the worker, so no session, capability, or audit check runs on
   * them. Anything a `"use client"` file declares as a constant is compiled
   * into one of those chunks and is readable by anyone — including an
   * anonymous visitor — regardless of how well the page rendering it is
   * guarded.
   *
   * That is not hypothetical: the rank contract levels, API grant counts, and
   * per-rank headcount behind `leadership.view.all` shipped this way, in
   * dist/client/assets/studio-*.js, cached immutably. They now live in a
   * server module and arrive as props.
   *
   * This scans the built client bundle for those values. It is a coarse net on
   * purpose — a substring check catches the mistake however it is reintroduced,
   * including through a different component.
   */
  const dir = new URL("../dist/client/assets/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
  assert.ok(files.length > 0, "no client chunks were built — this test would pass vacuously");

  /**
   * Human-authored training copy belongs only in authenticated server output.
   *
   * These markers are DERIVED from app/portal/training/library.ts rather than
   * listed here. A hard-coded phrase only ever pins the one body it was written
   * against: every body loaded afterwards ships unscanned until someone
   * remembers to come back and add a string, and nothing fails while they
   * forget. Deriving inverts that — a body approved and loaded tomorrow is
   * pinned by this test the moment it lands, with no second edit and no memory
   * involved.
   *
   * Normalised to LF first, for the same reason as the service worker check
   * above: on a Windows checkout the literals end `";\r`, and a `$`-anchored
   * match would find nothing at all — silently emptying the scan rather than
   * failing it. The assertions below are what make that impossible: zero bodies
   * or a body with no usable line is a test failure, never a quiet pass.
   */
  const librarySource = (
    await readFile(
      new URL("../app/portal/training/library.ts", import.meta.url),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");

  const bodies = [
    ...librarySource.matchAll(/^export const (\w+_BODY) = (".*");$/gm),
  ].map(([, name, literal]) => ({ name, text: JSON.parse(literal) }));

  // The training half of this scan is derived from the approved bodies, so an
  // empty library would silently reduce it to nothing. That must never happen
  // by accident — but as of the IMO changeover (2026-08-26) it is the real,
  // intended state: the bodies were unpublished with the rest of the previous
  // operator's content. So the emptiness is VERIFIED rather than assumed. A
  // library with no bodies but a slot still marked approved is the shape that
  // would leak an inline string past every check here, and it fails.
  //
  // The rest of the scan is unaffected: the pay-rate and Command Center
  // markers below are literal and still enforced, so this test keeps its teeth
  // while the training library is empty. Load approved bodies again and the
  // training markers derive themselves back into FORBIDDEN with no edit here.
  if (bodies.length === 0) {
    assert.equal(
      [...librarySource.matchAll(/state: "approved",/g)].length,
      0,
      "library.ts exports no approved bodies yet still marks a slot approved — " +
        "an inline body would render as approved language and go unscanned.",
    );
  }

  // One distinctive spoken line per body: the longest curly-quoted span in it.
  // Spoken lines are what a client chunk would leak, and the longest is the
  // least likely to collide with ordinary prose elsewhere in the bundle.
  const trainingMarkers = [
    ...new Set(
      bodies.map(({ name, text }) => {
        const spoken = [...text.matchAll(/“([^”]{20,})”/g)].map((m) => m[1]);
        assert.ok(
          spoken.length > 0,
          `${name} yielded no quoted line over 20 characters, so nothing pins it — ` +
            "the body is unscanned. Widen the extraction rather than dropping the body.",
        );
        return spoken.reduce((longest, line) =>
          line.length > longest.length ? line : longest,
        );
      }),
    ),
  ];

  // Rank names and the shape the economics compile to.
  const FORBIDDEN = [
    "Obsidian",
    "Zenith",
    "contract:140",
    "apiPerAgent:47",
    // Founder-only Command Center markers. These belong only in server output;
    // their presence in immutable assets would bypass every route guard.
    "session_01W4UZQ4izQyBNT2HEd9D9PK",
    "T3-S02-D01",
    "command-personal-v1",
    ...trainingMarkers,
  ];

  for (const name of files) {
    const source = await readFile(new URL(name, dir), "utf8");
    for (const marker of FORBIDDEN) {
      assert.ok(
        !source.includes(marker),
        `restricted pay-rate data (${marker}) is readable in the public chunk assets/${name}`,
      );
    }
  }
});

test("the group tabs are native disclosures — one open at a time, shut by an outside click or Escape — and the popout menu is gone", async () => {
  // Owner direction 2026-09-02: "I don't want the whole menu to pop out when
  // I click the menu button. I want each tab to have a little bit of options
  // when I click them." The five groups are <details> tabs in the top bar,
  // exclusive by the details `name` attribute on engines that honour it and
  // by the inline script everywhere else. Pinned against the source because
  // the shell renders only behind an authenticated session.
  const shell = await readFile(new URL("../app/portal/components.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(shell, /<nav className="portal-menu" aria-label="Portal sections">/, "the tab bar keeps the .portal-menu name the access tests slice");
  assert.match(
    shell,
    /<details\s+className=\{`portal-menu-group portal-menu-group-\$\{group\.toLowerCase\(\)\}`\}\s+key=\{group\}\s+name="portal-tabs"/,
    "each group is a <details> in the exclusive portal-tabs set",
  );
  assert.match(
    shell,
    /<summary className="portal-tab" aria-current=\{group === currentGroup \? "location" : undefined\}>/,
    "the current page's group is named on its tab",
  );
  assert.match(shell, /if \(groupItems\.length === 0\) return null;/, "a group with no rows a role can open is not rendered at all");

  // The popout and everything that opened it are retired.
  for (const relic of [
    'popover="auto"',
    'popoverTarget="portal-mobile-navigation"',
    'id="portal-mobile-drawer"',
    'htmlFor="portal-mobile-drawer"',
    "portal-dock-menu",
    "portal-topbar-menu",
    "PortalMenuContent",
  ]) {
    assert.ok(!shell.includes(relic), `${relic} must be retired with the popout menu`);
  }
  assert.doesNotMatch(css, /@supports selector\(:popover-open\)/, "no popover-guarded menu rules remain");
  assert.doesNotMatch(css, /portal-mobile-drawer-toggle/, "the checkbox fallback's rules go with it");

  // The one script: toggle observed in the capture phase (it does not
  // bubble), siblings shut, outside click shuts, a consumed Escape is marked
  // so the back control does not also fire. No network, no storage.
  const script = shell.match(/const TABS_SCRIPT =\s*'([^']+)'/)?.[1] ?? "";
  assert.ok(script.length > 0, "the tabs script must be an inline constant");
  assert.match(script, /document\.addEventListener\("toggle",[\s\S]*?\},true\)/, "toggle is observed in the capture phase");
  assert.match(script, /shut\(t\)/);
  assert.match(script, /document\.addEventListener\("click",/);
  assert.match(script, /e\.key!=="Escape"\|\|e\.defaultPrevented/);
  assert.match(script, /if\(open\)e\.preventDefault\(\)/, "a consumed Escape must not also fire the back control");
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|localStorage|sessionStorage/, "the tabs script touches no network and no storage");

  // Geometry: each dropdown is an opaque panel; tabs meet a 40px floor and
  // rows inside keep the 44px touch floor.
  assert.match(css, /\.portal-tab-panel \{[^}]*background-color: var\(--portal-panel\)/, "the dropdown paints a longhand colour that survives boost");
  assert.match(css, /\.portal-menu-group > summary\.portal-tab \{[^}]*min-height: 40px/);
  assert.match(css, /\.portal-tab-panel \.portal-menu-item \{ min-height: 44px; \}/);
});

test("the rail is a real sidebar column shown only for the rail placement on desktop widths", async () => {
  // Owner direction 2026-09-02: the rail "looks really weird with the little
  // block" — it is now a full-height sidebar (brand, Command, the direct
  // destinations, the account footer), not the dock re-laid. It renders in
  // every member's markup and the stylesheet shows it only when the stored
  // placement is rail AND the viewport is at least 960px; the dock hides in
  // that arrangement. Both surfaces carry the same capability-filtered doors.
  const shell = await readFile(new URL("../app/portal/components.tsx", import.meta.url), "utf8");
  const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");

  assert.match(shell, /<aside className="portal-rail" aria-label="Destinations">/);
  assert.match(shell, /const destinations = DOCK_DESTINATIONS\.map\(\(href\) => visible\.find\(\(entry\) => entry\.href === href\)\)/, "the rail's doors come from the same tuple and the same filtered list as the dock");
  assert.match(shell, /className="portal-rail-link portal-rail-deferred" aria-disabled="true"/, "the founder's deferred dialer marker is inert in the rail too");
  const railDeferred = shell.slice(shell.indexOf('className="portal-rail-link portal-rail-deferred"'), shell.indexOf("</span>\n          ) : null}", shell.indexOf('className="portal-rail-link portal-rail-deferred"')));
  assert.doesNotMatch(railDeferred, /href=|onClick|<Link|<a |<button/);
  assert.match(shell, /<a className="portal-signout portal-rail-signout" href=\{signOutPath\("\/"\)\}/, "sign-out stays a plain anchor — Link would prefetch it");

  assert.match(css, /\.portal-rail \{\s*display: none;/, "the rail is hidden unless the rail media block shows it");
  const wide = css.indexOf('@media (min-width: 960px) {\n  html[data-portal-nav="rail"]');
  assert.ok(wide >= 0);
  const block = css.slice(wide, css.indexOf("\n}\n", wide));
  assert.match(block, /html\[data-portal-nav="rail"\] \.portal \.portal-rail \{ display: flex; \}/);
  assert.match(block, /html\[data-portal-nav="rail"\] \.portal \.portal-dock \{ display: none; \}/);
  assert.match(block, /html\[data-portal-nav="rail"\] \.portal \.portal-shell \{[^}]*grid-template-columns: 250px minmax\(0, 1fr\)/);
  // The rail paints a longhand background colour (boost lesson) and the
  // navy skin re-scopes it exactly as it does the dock.
  assert.match(css, /\.portal-rail \{[^}]*background-color: var\(--portal-sidebar\)/);
  assert.match(css, /html\[data-portal-theme="thrive"\] \.portal \.portal-dock,\s*html\[data-portal-theme="thrive"\] \.portal \.portal-rail \{/);
});

test("Escape-back survives pre-popover engines", async () => {
  // querySelector selector-list parsing is non-forgiving: one unknown
  // pseudo-class rejects the WHOLE list, so ":popover-open, dialog[open]"
  // threw SyntaxError on pre-Popover engines, killing Escape-to-go-back
  // there. The :popover-open probe must sit alone inside try/catch.
  const back = await readFile(
    new URL("../app/portal/back-control.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    back,
    /querySelector\(\s*["'][^"']*:popover-open[^"']*,/,
    ":popover-open is back inside a querySelector selector list — SyntaxError on pre-popover engines",
  );
  assert.match(
    back,
    /try \{\s*if \(document\.querySelector\("\[popover\]:popover-open"\)\) return;\s*\} catch \{/,
    "the :popover-open probe is no longer try/caught — pre-popover engines throw on every Escape",
  );
});

test("sign-out refuses a return path that normalizes into a protocol-relative URL", async () => {
  // Open-redirect regression. `/..//evil.com` starts with a single slash, so it
  // passes a naive leading-`//` guard — but the URL parser normalizes the `..`
  // away and the path becomes `//evil.com`, whose origin still reads as ours.
  // Emitted verbatim into a Location header, `//evil.com` is a protocol-
  // relative URL and the browser resolves it to https://evil.com. This surface
  // is unauthenticated and the value is attacker-supplied, so the guard must
  // re-check AFTER normalization, not only before it.
  const hostile = [
    "/..//evil.com",
    "/foo/..//evil.com",
    "/./..//attacker.example",
    "//evil.com",
  ];

  for (const path of hostile) {
    const response = await fetchPath(
      `/auth/signout?return_to=${encodeURIComponent(path)}`,
    );
    const location = response.headers.get("location") ?? "";
    assert.ok(
      !location.startsWith("//"),
      `return_to=${path} produced a protocol-relative redirect: ${location}`,
    );
    assert.doesNotMatch(
      location,
      /evil\.com|attacker\.example/,
      `return_to=${path} leaked an external host into the redirect: ${location}`,
    );
  }

  // A genuine in-app path still round-trips, so the guard is not simply
  // refusing everything.
  const ok = await fetchPath(
    `/auth/signout?return_to=${encodeURIComponent("/portal/calls")}`,
  );
  assert.match(
    ok.headers.get("location") ?? "",
    /\/portal\/calls|\/access|\//,
    "a legitimate return path must still be honored",
  );
});

test("no page-scoped style ships a hardcoded colour instead of a theme token", async () => {
  // The bug this pins shut cost the founder a portal he could not read.
  //
  // Several pages ship their own minified `const STYLES` string. Four of them
  // were authored against the dark theme with a literal slate/teal/amber
  // palette and zero `--portal-*` tokens. The portal's boot default is dark,
  // so every one of them measured fine in the theme they were written in and
  // collapsed to roughly 1:1 contrast in Bright — headings rendering white on
  // cream, which is not "low contrast", it is invisible. Product names,
  // prices, and the leaderboard's own honesty sentence were absent from the
  // page while every test passed.
  //
  // A colour that is not a token cannot follow the theme. So: no page-scoped
  // style may declare a literal colour. Tokens resolve per theme; hex does not.
  const pages = [
    "../app/portal/inbound/page.tsx",
    "../app/portal/shop/page.tsx",
    "../app/portal/leaderboard/page.tsx",
    "../app/portal/navigation-upgrade.tsx",
    // The shell chrome — dock, menu, topbar markup — must stay token-only too.
    "../app/portal/components.tsx",
  ];

  for (const page of pages) {
    const source = await readFile(new URL(page, import.meta.url), "utf8");
    // Match a literal ANYWHERE in the declaration's value, not only as its
    // first token. The first version of this guard checked the head of the
    // value and therefore passed
    //   background:linear-gradient(145deg,rgba(56,35,10,.18),rgba(12,17,29,.9))
    // which is the Routing bridge card: a translucent gradient with no opaque
    // ground under it. Authored over a dark page it looked solid; over a light
    // one its first stop is 18% opaque, the page shows straight through, and
    // the light ink on top is unreadable. A literal buried in a gradient is
    // the same defect as a literal on its own, and hid for exactly one round.
    const literals = source.match(/(?:color|background|background-color|border-color)\s*:[^;}]*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))[^;}]*/g) ?? [];
    assert.deepEqual(
      literals,
      [],
      `${page} declares colour literally instead of through a --portal-* token: ${literals.join(", ")}`,
    );
  }
});

test("touch controls meet the 44px floor and answer a tap without delay", async () => {
  // The portal installs to the home screen and is used one-handed, so it is
  // judged against native apps. Three properties carry most of that feeling,
  // and each has failed here before:
  //
  //   The audio transport shipped at 33px with a 13px slider thumb — a desktop
  //   control handed to a thumb. Apple's floor is 44x44pt.
  //
  //   Without touch-action: manipulation the browser waits 300ms for a
  //   possible double-tap before acting. That wait is most of what "feels
  //   like a website" means.
  //
  //   -webkit-tap-highlight-color: transparent removes the grey flash. Doing
  //   that WITHOUT providing a press state leaves a control that gives no
  //   feedback at all, which is worse than the flash.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /touch-action:\s*manipulation/,
    "interactive elements must not wait 300ms for a possible double-tap");

  assert.match(css, /-webkit-tap-highlight-color:\s*transparent/,
    "the grey tap flash is replaced by a real press state, not left as-is");

  assert.match(css, /:active[^{]*\{[^}]*transform:\s*scale\(/,
    "removing the tap flash requires giving a press state back");

  assert.match(css, /width:\s*max\(100%,\s*44px\)/,
    "small controls expand their hit area to the 44px floor on touch");

  assert.match(css, /-webkit-text-size-adjust:\s*100%/,
    "text sizing stays the user's decision");

  // A press state that ignores prefers-reduced-motion is a press state that
  // moves the screen for someone who asked it not to.
  const reducedBlocks = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\n\}/g) ?? [];
  assert.ok(
    reducedBlocks.some((block) => /:active/.test(block) && /transform:\s*none/.test(block)),
    "the press state must be dropped under prefers-reduced-motion",
  );

  // iOS Safari zooms the viewport on focusing any input under 16px and never
  // zooms back. The lodge code field is the first thing a locked-out person
  // meets; throwing the page at them is not an option.
  assert.match(css, /input,\s*select,\s*textarea\s*\{\s*font-size:\s*max\(16px/,
    "inputs must be 16px or larger on touch or iOS zooms the page and stays there");
});

test("nothing traps the vertical wheel", async () => {
  // Three separate founder reports came from this one property, applied three
  // different ways:
  //
  //   "cant scroll while hover over some these tabs" — contain on
  //   .portal-main, which is not a scroll container at all.
  //
  //   "CLEARLY still CANNOT SCROLL ON BUTTONS" — contain on the sidebar nav.
  //   With the pointer over the rail's links the wheel scrolled the list and
  //   then stopped, instead of handing off to the page behind it.
  //
  //   A page that stops scrolling under the cursor reads as broken, and the
  //   person reporting it has no way to know which element caused it. That is
  //   what makes this worth a test rather than a comment.
  //
  // BLOCK-AXIS containment is therefore banned outright. INLINE-axis
  // containment stays allowed and is not matched here: a horizontally
  // scrolling table or tab strip should not drag the page sideways, and
  // stopping that has nothing to do with the vertical wheel.
  // Comments are stripped first. The explanations of WHY this property is
  // banned necessarily name it, and a guard that fails on its own rationale
  // teaches people to delete the rationale.
  const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const offenders = (css.match(/overscroll-behavior(?:-y|-block)?\s*:\s*(?:contain|none)/g) ?? [])
    .filter((declaration) => !/-inline/.test(declaration));

  assert.deepEqual(
    offenders,
    [],
    `vertical overscroll containment traps the wheel over that element: ${offenders.join(", ")}`,
  );
});

test("the dock and menu stay where the founder put them", async () => {
  // Founder, 2026-08-18, with a screenshot of the rail attached: "MAKE SITE
  // STAY HERE". That is a decision about a specific rendered state, and a
  // decision about pixels survives exactly as long as something measures it.
  // This test held the old rail's rows at 38px through four rounds of
  // "buttons still way too huge" — #79, #81, #87, and the shrink after.
  //
  // 2026-08-31 the rail retired: navigation is now a fixed bottom dock that
  // opens a slide-up grouped menu. The constants below changed in the same
  // commit as that chrome, which is exactly what this test always asked for.
  // Three independent things are pinned in the new shape:
  //
  //   HEIGHT — INVERTED. The rail was a dense pointer surface and carried a
  //   40px ceiling; the menu is a thumb surface and every row carries the
  //   44px touch FLOOR instead. The old ban on unconditional touch-sized
  //   floors is gone with the rail it protected — on this chrome the floor
  //   is the design, and a row that shrinks under it is the new drift.
  //
  //   STRUCTURE. Three groups, in this order. The rail's five (and the
  //   dock-era menu that inherited them) consolidated to three in the
  //   2026-09-02 IA consolidation — this constant changed in the same commit
  //   as that regroup, which is exactly what this test always asked for. The
  //   groups still carry PLATFORM-MAP.md's categories, so regrouping the menu
  //   silently invalidates that document.
  //
  //   PLACEMENT. The dock is the shell's one anchored surface. It must stay
  //   position: fixed and keep the home-indicator inset in its offset, or a
  //   phone with a gesture bar draws it half under the housing.
  //
  // If a redesign genuinely wants different rows or groups, change these
  // constants in the same commit and say so in the message. That is the
  // point: the number stops being drift nobody measured and becomes a
  // decision someone made.

  // Comments are stripped first, for the reason the wheel guard strips them:
  // a guard that trips on its own explanation teaches people to delete the
  // explanation.
  const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const TOUCH_FLOOR = 44;

  // Largest absolute length in a value, so `max(100%, 44px)` reads 44 and a
  // bare percentage — unresolvable from text — reads nothing.
  const maxPx = (value) => {
    let largest = 0;
    for (const [, amount, unit] of (value ?? "").matchAll(/(-?[\d.]+)\s*(px|rem)\b/g)) {
      const px = unit === "px" ? Number(amount) : Number(amount) * 16;
      if (px > largest) largest = px;
    }
    return largest;
  };

  // Last declaration wins among equal-specificity rules, so scan forward and
  // keep the final hit. The lookbehind is what stops `height` matching inside
  // `min-height` and `line-height`.
  const winning = (selector, property) => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1]
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .includes(selector),
    );
    let value = null;
    for (const rule of rules) {
      const declared = [...rule[2].matchAll(new RegExp(`(?<![-\\w])${property}\\s*:\\s*([^;}]+)`, "g"))];
      if (declared.length) value = declared.at(-1)[1].trim();
    }
    return value;
  };

  const rowFloor = maxPx(winning(".portal-menu-item", "min-height"));
  assert.ok(
    rowFloor > 0,
    "the menu row's metrics could not be read at all — the selector this test measures has been renamed",
  );
  assert.ok(
    rowFloor >= TOUCH_FLOOR,
    `the menu row floors at ${rowFloor}px, under the ${TOUCH_FLOOR}px touch floor the founder ` +
      "approved — a thumb must be able to land on every row of the only navigation surface",
  );

  // Structure: FIVE groups, this order (Dispatch work order 1A, 2026-09-02;
  // the three-group pin this replaces is re-anchored, not deleted). Read from
  // the source of truth rather than from rendered HTML, so it holds for every
  // role's filtered view.
  const components = await readFile(new URL("../app/portal/components.tsx", import.meta.url), "utf8");
  const declared = components.match(/const NAV_GROUPS = \[([^\]]+)\]/);
  assert.ok(declared, "NAV_GROUPS has been renamed or restructured — the menu's section list is no longer readable");
  const groups = declared[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1));
  assert.deepEqual(
    groups,
    ["Today", "Clients", "Selling", "Standing", "Administration"],
    "the menu's five sections are the ones Dispatch ordered and the ones PLATFORM-MAP.md documents",
  );
  // Every group carries a subtitle, and the subtitle table is keyed by the
  // same five names — a sixth group cannot be added without a subtitle, and a
  // subtitle cannot be orphaned by renaming a group.
  const subtitles = components.match(/const NAV_GROUP_SUBTITLES: Record<NavGroup, string> = \{([^}]+)\}/);
  assert.ok(subtitles, "NAV_GROUP_SUBTITLES must stay a Record keyed by NavGroup");
  assert.deepEqual(
    [...subtitles[1].matchAll(/^\s*(\w+): "([^"]+)",?$/gm)].map((m) => m[1]),
    groups,
    "each of the five groups carries exactly one subtitle, in group order",
  );

  // A grid that grows must be told where to put the surplus. The menu's
  // columns and groups are grids; a grid's default stretch pushes every
  // leftover pixel into the TRACKS. That is the exact "tabs become enlarged
  // on dash board" mechanism from the rail era, and it is invisible to the
  // floor above, which reads declarations and cannot see a row that grew
  // without any declaration changing. A layout that only misbehaves when the
  // content happens to be short is worse than one that is always wrong: it
  // looks like caching, or like the network.
  assert.ok(
    /\.portal-menu-columns \{[^}]*align-items:\s*start/.test(css),
    ".portal-menu-columns is a grid whose tracks stretch to the tallest column, so it must " +
      "declare align-items: start or every group's rows absorb the surplus height",
  );
  assert.ok(
    /\.portal-menu-group \{[^}]*align-content:\s*start/.test(css),
    ".portal-menu-group is a grid that can be taller than its rows, so it must declare " +
      "align-content: start or its rows absorb the surplus height",
  );

  // Placement: the dock is fixed, and its offset clears the home indicator.
  const dock = css.match(/(?:^|\n)\.portal-dock \{([^}]*)\}/);
  assert.ok(dock, "no .portal-dock rule was found at all — the dock selector has been renamed");
  assert.match(
    dock[1],
    /position:\s*fixed/,
    "the dock must stay position: fixed — it is the shell's one anchored surface",
  );
  assert.match(
    dock[1],
    /env\(safe-area-inset-bottom\)/,
    "the dock's offset must include the home-indicator inset or a gesture-bar phone draws it half off-screen",
  );
});

test("no client module reaches the server-only training library", async () => {
  /**
   * Two modules in this app carry a documented server-only rule:
   * `app/portal/training/library.ts` (approved training language) and
   * `app/portal/access.ts` (the authorization checks themselves). Until now
   * each was pinned by hand — a `"use client"` assertion on the module itself,
   * a substring scan of the built chunks, and one hard-coded pair
   * (error.tsx must not import access). None of those sees the shape the rule
   * actually forbids.
   *
   * A transitive hop leaks exactly as surely as a direct import. `"use client"`
   * marks a boundary, not a file: everything the boundary module imports —
   * and everything those imports import — is compiled into the client chunk
   * that ships under /assets, which is served straight from the ASSETS binding
   * with no session, capability, or audit check in front of it. So
   * `dialpad.tsx -> ./helpers -> ../training/library` publishes the approved
   * bodies just as completely as `dialpad.tsx -> ../training/library`, and it
   * does it without any single file looking wrong in review. That is the
   * failure this walks the whole graph to catch.
   *
   * Approved bodies keep being loaded into the library, so the value of the
   * mistake grows with every one of them while the chance of catching it by
   * reading a single diff shrinks.
   */
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, relative, resolve } = await import("node:path");

  const root = fileURLToPath(new URL("../", import.meta.url));
  const appDir = resolve(root, "app");
  const show = (file) => relative(root, file).split("\\").join("/");

  const sources = (await readdir(appDir, { recursive: true }))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => resolve(appDir, name));

  const read = new Map();
  const sourceOf = async (file) => {
    if (!read.has(file)) read.set(file, await readFile(file, "utf8"));
    return read.get(file);
  };

  /**
   * The directive, and ONLY the directive. Both protected modules explain the
   * rule in their header comments by quoting `"use client"`, so a plain grep
   * reports them as client modules and this test starts failing on correct
   * code — which is how a guard gets deleted. Anchor to the start of the file,
   * allow the byte-order mark, whitespace, and any leading comments (a
   * bundler still honours a directive that sits under a licence header), then
   * require the string itself to be the first thing that is not a comment.
   * The block-comment skip is non-greedy, so it stops at the END of the
   * header comment rather than swallowing past a directive further down.
   */
  const CLIENT_DIRECTIVE = /^\uFEFF?\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']\s*;/;

  const clients = new Set();
  for (const file of sources) {
    if (CLIENT_DIRECTIVE.test(await sourceOf(file))) clients.add(file);
  }

  // Vacuity guard, asserted before anything else. Every assertion below is of
  // the form "no path from a client module reaches X", which is trivially
  // true when the set of client modules is empty. If the directive regex is
  // ever broken by a formatting change — or by someone hardening it against a
  // false positive — this fails loudly instead of passing on an empty walk.
  assert.ok(
    clients.size > 0,
    "no `\"use client\"` module was detected anywhere under app/, so the import walk below " +
      "would pass without examining anything — the directive test has broken",
  );

  // Path aliases come from tsconfig.json rather than being assumed: today the
  // only entry is `@/* -> ./*` and nothing under app/ uses it yet, so a
  // resolver that handled relative specifiers alone would look correct right
  // up until the first `@/portal/...` import made the graph silently
  // incomplete — the failure mode a guard can least afford.
  const { paths = {} } = JSON.parse(await readFile(resolve(root, "tsconfig.json"), "utf8")).compilerOptions ?? {};

  const fromAlias = (specifier) => {
    const targets = [];
    for (const [pattern, replacements] of Object.entries(paths)) {
      if (!pattern.includes("*")) {
        if (specifier === pattern) targets.push(...replacements.map((t) => resolve(root, t)));
        continue;
      }
      const [head, tail = ""] = pattern.split("*");
      if (!specifier.startsWith(head) || !specifier.endsWith(tail)) continue;
      const middle = specifier.slice(head.length, tail.length ? -tail.length : undefined);
      targets.push(...replacements.map((t) => resolve(root, t.replace("*", middle))));
    }
    return targets;
  };

  // Extension guesses in TypeScript's own order. A specifier that lands on
  // anything but a .ts/.tsx file (`./schedule.html?raw`, a bare package) is
  // not an edge in this graph.
  const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
  const resolveSpecifier = (importer, specifier) => {
    const bare = specifier.split("?")[0];
    const bases = bare.startsWith(".") ? [resolve(dirname(importer), bare)] : fromAlias(bare);
    for (const base of bases) {
      for (const extension of CANDIDATES) {
        const candidate = base + extension;
        if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
      }
    }
    return null;
  };

  /**
   * Every form that makes one module's text part of another's build: static
   * and re-exported `from`, bare side-effect imports, and `import(...)`.
   * `import type` counts. It emits nothing, so on its own it leaks nothing —
   * but it is one deleted keyword away from the import that does, it points
   * at the file where the protected values live, and a rule with an exception
   * in it is the rule people edit toward. Over-approximating here costs a
   * false alarm that a human resolves in a minute; under-approximating costs
   * the training bodies.
   */
  const specifiers = (source) => [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);

  // One breadth-first walk seeded with every client module at once, keeping
  // the edge that first reached each file. That parent chain is what turns
  // "something imports the library" into the actual route someone has to fix.
  const cameFrom = new Map(clients.size ? [...clients].map((file) => [file, null]) : []);
  const queue = [...clients];
  while (queue.length) {
    const importer = queue.shift();
    for (const specifier of specifiers(await sourceOf(importer))) {
      const imported = resolveSpecifier(importer, specifier);
      if (!imported || cameFrom.has(imported)) continue;
      cameFrom.set(imported, importer);
      queue.push(imported);
    }
  }

  const chainTo = (file) => {
    const chain = [];
    for (let step = file; step; step = cameFrom.get(step)) chain.unshift(show(step));
    return chain.join("\n    -> ");
  };

  // Both modules carry the same documented rule, so both get the same walk.
  // access.ts was pinned for exactly one importer (app/portal/error.tsx);
  // this covers every file that exists and every file that will.
  const SERVER_ONLY = [
    [
      resolve(appDir, "portal/training/library.ts"),
      "approved training language would ship in a public immutable asset",
    ],
    [
      resolve(appDir, "portal/access.ts"),
      "authorization would move to the client, where the visitor controls it",
    ],
  ];

  for (const [target, consequence] of SERVER_ONLY) {
    assert.ok(existsSync(target), `${show(target)} has moved — this guard is now pointed at nothing`);
    assert.ok(
      !cameFrom.has(target),
      `a \`"use client"\` module reaches ${show(target)}, so ${consequence}:\n    ${chainTo(target)}`,
    );
  }
});

test("no surface can be swiped sideways off the screen", async () => {
  // Founder, 2026-08-19, with a screenshot of the training page dragged half
  // off a phone: "I can swipe right forever on scripts".
  //
  // Measured in Chromium against the built bundle before this test was
  // written: /portal/training laid out 2076px wide inside a 390px viewport —
  // 1686px of page you could swipe into, taking the whole layout with it.
  //
  // THE CAUSE WAS NOT A MISSING `overflow-x`. The tab strip already had
  // `overflow-x: auto` and already scrolled correctly; its own box measured
  // 366px. What `overflow-x: auto` does not do on its own is stop the
  // strip's 1561px of content from counting toward the DOCUMENT's scrollable
  // width. Paint containment is what ends that propagation, which is why the
  // rule being pinned here is `contain`, not an overflow declaration —
  // someone reading the file and seeing `overflow-x: auto` would reasonably
  // conclude the strip was already handled, and delete this.
  //
  // The second half is the account chip. An implicit `auto` grid column
  // refuses to shrink below its content's min-content width, so when the top
  // bar ran out of room the chip collapsed to 4px and its name and rank spilled
  // out of the bar rather than ellipsising — 23px to 134px of overflow across
  // 700-1024px, where the rail is on screen and the bar is still full width.
  //
  // Verified 0px page overflow at 320, 360, 390, 430, 600, 700, 768, 820,
  // 900, 1024, 1100, 1280 and 1440 after the fix, with the tab strip still
  // scrolling horizontally at every one of them.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const navigationUpgrade = await readFile(new URL("../app/portal/navigation-upgrade.tsx", import.meta.url), "utf8");

  const tabStrip = css.match(/\.training-tabs \{[^}]*\}/s)?.[0] ?? "";
  assert.match(
    tabStrip,
    /contain:\s*paint/,
    ".training-tabs must keep paint containment, or its scrolled tabs grow the page again",
  );

  const sectionTabs = css.match(/\.training-section-tabs \{[^}]*\}/s)?.[0] ?? "";
  assert.match(
    sectionTabs,
    /contain:\s*paint/,
    ".training-section-tabs scrolls the same way and needs the same containment",
  );

  const chip = css.match(/\.portal-member-name \{[^}]*\}/s)?.[0] ?? "";
  assert.match(
    chip,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    "the account chip's column must be minmax(0, 1fr) so it can shrink instead of spilling",
  );

  const topbar = css.match(/\.portal-topbar \{[^}]*\}/s)?.[0] ?? "";
  assert.match(
    topbar,
    /flex-wrap:\s*wrap/,
    "the top bar must wrap rather than push its account cluster past the viewport",
  );
  assert.match(topbar, /position:\s*sticky/);
  assert.match(topbar, /top:\s*0/);
  assert.match(navigationUpgrade, /thrive-account-call-stack/);
  assert.match(navigationUpgrade, /thrive-topbar-call-control/);
  assert.match(navigationUpgrade, /thrive:phone-panel/);
  assert.match(navigationUpgrade, /thrive:phone-state/);
  assert.match(
    navigationUpgrade,
    /@media\(max-width:620px\)\{\.thrive-account-call-stack\{min-width:44px;width:44px\}/,
    "the persistent Calls control must collapse to one 44px touch target rather than leave the viewport",
  );
});

test("the dock and menu keep an opaque background in boost mode, in every theme", async () => {
  // REGRESSION, reported 2026-08-26 against the retired rail: with BOOSTED
  // on, opening the mobile menu drawer in Bright and Dark rendered the
  // drawer's text on top of the page's text. The drawer was fully
  // transparent.
  //
  // The cause was a two-rule interaction that neither rule looks wrong alone:
  //
  //   .portal-sidebar { background: <gradients only>; }        // shorthand
  //   [data-portal-performance="boost"] .portal-sidebar {
  //     background-image: none;                                // strips them
  //   }
  //
  // The shorthand resets `background-color` to `transparent`, boost removes
  // the images, and nothing is left. The rail is gone; the mechanism is not.
  // The bottom dock and the slide-up menu are the surfaces that now float
  // over page text in every theme, so each must paint a longhand
  // `background-color` that survives boost stripping its images. This pins
  // the shape rather than the symptom: any return to the shorthand
  // reintroduces the bug for every theme at once.
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const chrome of [".portal-dock", ".portal-menu"]) {
    // Several rules target each surface (open/closed states, sheet widths);
    // scan them all by content rather than by position so a reordering of
    // the stylesheet cannot silently un-pin this.
    const blocks = [
      ...css.matchAll(new RegExp(`(?:^|\\n)\\s*\\${chrome}\\s*\\{([^}]*)\\}`, "g")),
    ].map((m) => m[1]);
    assert.ok(blocks.length > 0, `no ${chrome} rule was found at all`);
    assert.ok(
      blocks.some((b) => /background-color:\s*var\(--portal-sidebar\)/.test(b)),
      `${chrome} must set background-color as a LONGHAND — the \`background\` shorthand ` +
        "resets it to transparent, and boost mode then strips the images, leaving the " +
        "surface see-through over the page",
    );
    for (const block of blocks) {
      assert.doesNotMatch(
        block,
        /(?:^|[\s;])background:\s*(?:radial-|linear-)gradient/,
        `a ${chrome} rule is on the \`background\` shorthand with images, which resets ` +
          "background-color to transparent",
      );
    }
  }

  // The boost rules may strip images and shadows — that is their job — but
  // they must not be the only thing standing between the chrome and
  // transparency.
  for (const boosted of css.matchAll(/html\[data-portal-performance="boost"\][^{}]*\{[^}]*\}/g)) {
    if (!/\.portal-dock|\.portal-menu/.test(boosted[0])) continue;
    assert.doesNotMatch(
      boosted[0],
      /background:\s*none|background-color:\s*transparent/,
      "boost mode must not clear the dock or menu background COLOUR, only the images",
    );
  }
});

test("every link on the Cloud Command Center goes somewhere that exists", async () => {
  // The page is a directory of things that live elsewhere — environments and
  // sessions on claude.ai, routines, the Inkbox desk, the repo. Its cards are
  // only worth anything if they open those things, so each carries an href.
  //
  // The failure this guards is SILENT. Rename or delete /go/routines and the
  // card still renders, still looks clickable, and lands on a 404 — nothing
  // throws, no test fails, and it is found by a person clicking it. So the
  // internal destinations are checked against the filesystem here.
  //
  // Deep links are deliberately absent: several rows carry placeholder ids
  // (AGT-001, ENV-02) rather than real session ids, so there is no per-item
  // URL to build and none is invented. They point at the surface that lists
  // the real ones instead.
  const page = await readFile(
    new URL("../app/portal/command/cloud/page.tsx", import.meta.url),
    "utf8",
  );

  const block = page.match(/const LINKS = \{[\s\S]*?\} as const;/)?.[0];
  assert.ok(block, "the LINKS table must stay in one place, not scatter through the file");

  const targets = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 8, "expected the full set of destinations");

  const internal = targets.filter((t) => t.startsWith("/"));
  assert.ok(internal.length >= 5, "expected several in-portal destinations");

  for (const target of internal) {
    const path = target.split("#")[0];
    const asRoute = new URL(`../app${path}/route.ts`, import.meta.url);
    const asPage = new URL(`../app${path}/page.tsx`, import.meta.url);
    const exists = await readFile(asRoute, "utf8").then(
      () => true,
      () => readFile(asPage, "utf8").then(() => true, () => false),
    );
    assert.ok(exists, `${target} is linked from the Cloud Command Center but has no route`);
  }

  // Anything leaving the portal must not hand the new tab a handle on this
  // window. rel="noopener" is the whole of that protection.
  const external = targets.filter((t) => t.startsWith("http"));
  assert.ok(external.length >= 2, "expected external destinations");
  assert.match(
    page,
    /target="_blank"[\s\S]{0,120}rel="noopener noreferrer"/,
    "external links must open with rel=noopener noreferrer",
  );

  // A disabled channel gets no link — an opener for something switched off is
  // worse than a row that plainly says it is off.
  assert.match(
    page,
    /\{ type: "iMessage", status: "disabled", address: "Not enabled" \}/,
    "the disabled iMessage channel must stay unlinked",
  );
});

test("week arithmetic holds across year boundaries and Sundays", async () => {
  // The check-in route computes week_key server-side from these helpers, and
  // the dashboard's windowed counts compare their date-prefix strings — so a
  // wrong week here is a commitment filed under the wrong week and a
  // production count windowed wrong, silently. The two places ISO weeks go
  // wrong are the year boundary (the first days of January can belong to the
  // OLD year's last week) and Sunday (day 0 in JavaScript, day 7 in ISO).
  const { isoWeekKey, isoWeekStart, isoPrevWeekStart } = await import(
    "../app/portal/week.ts"
  );

  // 2026-01-01 is a Thursday: ISO says it anchors week 1 of its own year.
  assert.equal(isoWeekKey(new Date("2026-01-01T12:00:00Z")), "2026-W01");
  // 2027-01-01 is a Friday: it belongs to the PREVIOUS year's final week.
  assert.equal(isoWeekKey(new Date("2027-01-01T12:00:00Z")), "2026-W53");
  assert.equal(isoWeekStart(new Date("2027-01-01T12:00:00Z")), "2026-12-28");

  // Sunday maps into the Monday-STARTED week, not the one about to begin.
  const sunday = new Date("2026-09-06T23:59:59Z");
  assert.equal(isoWeekKey(sunday), "2026-W36");
  assert.equal(isoWeekStart(sunday), "2026-08-31");
  assert.equal(
    isoWeekKey(sunday),
    isoWeekKey(new Date("2026-08-31T00:00:00Z")),
    "a Sunday and its preceding Monday are the same ISO week",
  );

  // The previous week's Monday is exactly seven days back, across months.
  assert.equal(isoPrevWeekStart(sunday), "2026-08-24");
  assert.equal(isoPrevWeekStart(new Date("2026-09-07T00:00:00Z")), "2026-08-31");

  // Whatever instant "now" is, the invariants the queries lean on hold: the
  // key matches its own week start, and both strings are the shape the
  // lexical comparisons and the 0013 CHECK constraint expect.
  const now = new Date();
  assert.match(isoWeekKey(now), /^\d{4}-W\d{2}$/);
  assert.match(isoWeekStart(now), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isoWeekKey(now), isoWeekKey(new Date(`${isoWeekStart(now)}T00:00:00Z`)));
});


/* ────────────────────────────────────────────────────────────────────────
 * Five-group IA, carrier portals, lead-portal removal, Marketplace label, the
 * Script Vault import, and the Dialer's temporary bridge — source-level pins
 * (Dispatch work order 1A/1B, 2026-09-02). Runtime counterparts live in
 * portal-authorization.test.mjs.
 * ──────────────────────────────────────────────────────────────────────── */

async function readTree(dir, exts) {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (exts.some((ext) => entry.endsWith(ext))) out.push([full, readFileSync(full, "utf8")]);
    }
  };
  walk(dir);
  return out;
}

test("the retired lead-portal link is gone from every source file, every test, and every asset", async () => {
  const { fileURLToPath } = await import("node:url");
  const files = [
    ...(await readTree(fileURLToPath(new URL("../app", import.meta.url)), [".ts", ".tsx", ".css"])),
    ...(await readTree(fileURLToPath(new URL("../public", import.meta.url)), [".js", ".html", ".json", ".svg"])),
    ...(await readTree(fileURLToPath(new URL("../scripts", import.meta.url)), [".mjs"])),
    ...(await readTree(fileURLToPath(new URL("../tests", import.meta.url)), [".mjs"])),
  ];
  // The needle is assembled so this file cannot match itself.
  const needle = new RegExp("re" + "agan", "i");
  const hits = files.filter(([, src]) => needle.test(src)).map(([path]) => path);
  assert.deepEqual(hits, [], `the retired lead portal must have no entry, label, icon, relabel, link, or test pin: ${hits.join(", ")}`);
});

test("the carrier portals are plain login links in Selling, and the long Aetna query URL exists nowhere", async () => {
  const components = await readFile(new URL("../app/portal/components.tsx", import.meta.url), "utf8");
  const nav = components.slice(components.indexOf("const NAV: readonly NavItem[]"), components.indexOf("function visibleNav("));

  for (const [label, href] of [
    ["Aetna — carrier portal", "https://www.aetna.com/aimmanageaccount/login"],
    ["Ethos — carrier portal", "https://agents.ethoslife.com/login"],
  ]) {
    const at = nav.indexOf(`href: "${href}"`);
    assert.ok(at >= 0, `${label} must link to exactly ${href}`);
    const entry = nav.slice(at, nav.indexOf("},", at));
    assert.match(entry, new RegExp(`label: "${label}"`), `${label} must be labelled as a carrier portal`);
    assert.match(entry, /group: "Selling"/, `${label} belongs in Selling`);
    assert.match(entry, /capability: "dashboard\.view\.self"/, `${label} reuses the existing external-link guard, unwidened`);
    assert.match(entry, /external: true/, `${label} must take the external-anchor path (new tab, noopener noreferrer)`);
    assert.match(entry, /No affiliation implied/, `${label} must not claim carrier affiliation`);
  }
  // The external-anchor path itself: one shape for every external item.
  assert.match(
    components,
    /item\.external \? \(\s*<a[\s\S]{0,400}target="_blank"\s+rel="noopener noreferrer"/,
    "external menu items must open in a new tab with rel=noopener noreferrer",
  );

  // The long Aetna identity-transaction URL supplied during design must
  // appear nowhere: source, tests, assets, scripts. The needle is assembled
  // so this assertion cannot match its own text.
  const { fileURLToPath } = await import("node:url");
  const everywhere = [
    ...(await readTree(fileURLToPath(new URL("../app", import.meta.url)), [".ts", ".tsx", ".css", ".html"])),
    ...(await readTree(fileURLToPath(new URL("../public", import.meta.url)), [".js", ".html", ".json"])),
    ...(await readTree(fileURLToPath(new URL("../scripts", import.meta.url)), [".mjs"])),
    ...(await readTree(fileURLToPath(new URL("../tests", import.meta.url)), [".mjs"])),
  ];
  const forbidden = new RegExp("identity" + "Transaction", "i");
  const leaks = everywhere.filter(([, src]) => forbidden.test(src)).map(([path]) => path);
  assert.deepEqual(leaks, [], `the long Aetna query URL must not exist anywhere: ${leaks.join(", ")}`);
  // And no Aetna URL other than the plain login page, anywhere in app/.
  const aetnaUrls = new Set();
  for (const [, src] of everywhere) {
    for (const m of src.matchAll(/https?:\/\/[^\s"'`<>]*aetna\.com[^\s"'`<>]*/gi)) aetnaUrls.add(m[0]);
  }
  assert.deepEqual([...aetnaUrls], ["https://www.aetna.com/aimmanageaccount/login"], "only the plain Aetna login URL may appear");
});

test("Marketplace is the one label for /portal/shop, and the Coming-online footer is retired", async () => {
  const components = await readFile(new URL("../app/portal/components.tsx", import.meta.url), "utf8");
  const upgrade = await readFile(new URL("../app/portal/navigation-upgrade.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  const shop = components.slice(components.indexOf('href: "/portal/shop"'));
  assert.match(shop.slice(0, 400), /label: "Marketplace"/, "the shop row is labelled Marketplace server-side");
  assert.doesNotMatch(components, /label: "Exchange"/, "no menu row may still be labelled Exchange");
  assert.doesNotMatch(components, /GO_LABELS/, "the go-row no longer needs a label override — the label is the label");
  assert.doesNotMatch(upgrade, /Marketplace"\)/, "no client-side relabel remains; the server renders the final label");
  // The route is unchanged: label-only.
  assert.match(components, /href: "\/portal\/shop"/, "the Marketplace route stays /portal/shop");

  // The footer is gone — and its former stubs are real, gated rows now.
  assert.doesNotMatch(components, /portal-menu-coming|Coming online/, "the Coming-online footer must be retired");
  assert.doesNotMatch(css, /\.portal-menu-coming/, "the footer's CSS rule goes with it");
  for (const [href, capability] of [
    ["/portal/book", "book.view.self"],
    ["/portal/team", "team.view"],
  ]) {
    const at = components.indexOf(`href: "${href}"`);
    assert.ok(at >= 0, `${href} must be a menu row`);
    const entry = components.slice(at, components.indexOf("},", at));
    assert.match(entry, new RegExp(`capability: "${capability.replace(/\./g, "\\.")}"`), `${href} keeps its guard`);
    assert.match(entry, /state: "pending"/, `${href} is a placeholder row`);
    assert.match(entry, /stateLabel: "Source not connected"/, `${href} says honestly that its source is not connected`);
  }
  // Leadership is a live surface (Dispatch revision 2026-09-02): a normal
  // gated Standing row, never a placeholder, guard unchanged.
  {
    const at = components.indexOf('href: "/portal/leadership"');
    assert.ok(at >= 0, "/portal/leadership must be a menu row");
    const entry = components.slice(at, components.indexOf("},", at));
    assert.match(entry, /capability: "leadership\.view\.all"/, "Leadership keeps its guard");
    assert.match(entry, /group: "Standing"/, "Leadership sits in Standing");
    assert.match(entry, /state: "live"/, "Leadership links the live surface, not a placeholder");
    assert.doesNotMatch(entry, /Source not connected/, "Leadership must not be labelled as unconnected");
  }
  // The Callback Queue is a door to the existing Calls voicemail tab, gated
  // on the book so roles without one lose the whole Clients group.
  const queue = components.slice(components.indexOf('href: "/portal/calls?tab=voicemail"'));
  assert.match(queue.slice(0, 400), /label: "Callback Queue"[\s\S]*capability: "book\.view\.self"[\s\S]*group: "Clients"/);
  // Empty-group suppression is the mechanism that keeps a suppressed group
  // from rendering a bare heading; pin the line that does it.
  assert.match(components, /if \(groupItems\.length === 0\) return null;/, "fail-closed empty-group suppression must stay");
});

test("the route guards are invariant: same call sites, same capabilities, same routes as before the IA change", async () => {
  // Work order 1A/1B forbids any access-guard change. This is the evidence:
  // every guard call in app/ (page, route, and the definitions in access.ts),
  // with its literal arguments, pinned as a sorted list. A widened guard, a
  // dropped guard, a moved route, or a new guarded surface changes this list
  // and fails here — and MUST be reviewed as a governance change, not a nit.
  const { fileURLToPath } = await import("node:url");
  const { relative } = await import("node:path");
  const appDir = fileURLToPath(new URL("../app", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const actual = [];
  for (const [path, src] of await readTree(appDir, [".ts", ".tsx"])) {
    for (const m of src.matchAll(/\b(requireCapability|requireFounder|requireCommandCenter)\(([\s\S]*?)\)/g)) {
      const literals = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      actual.push(`${relative(root, path).replace(/\\/g, "/")}|${m[1]}|${literals.join(",")}`);
    }
  }
  actual.sort();
  assert.deepEqual(actual, [
    "app/go/desk/route.ts|requireFounder|/go/desk,go.desk",
    "app/go/hq/route.ts|requireFounder|/go/hq,go.hq",
    "app/go/routines/route.ts|requireFounder|/go/routines,go.routines",
    "app/portal/access.ts|requireCapability|",
    "app/portal/access.ts|requireCommandCenter|command.view",
    "app/portal/access.ts|requireFounder|audit.view,audit.view",
    "app/portal/announcements/page.tsx|requireCapability|dashboard.view.self,/portal/announcements",
    "app/portal/audit/page.tsx|requireFounder|/portal/audit",
    "app/portal/book/customers/route.ts|requireCapability|book.view.self,/portal/book/customers",
    "app/portal/book/page.tsx|requireCapability|book.view.self,/portal/book",
    "app/portal/book/policies/route.ts|requireCapability|book.view.self,/portal/book/policies",
    "app/portal/calls/page.tsx|requireCapability|calls.answer,/portal/calls",
    "app/portal/calls/review/[id]/page.tsx|requireCapability|calls.review",
    "app/portal/calls/review/page.tsx|requireCapability|calls.review,/portal/calls/review",
    "app/portal/checkin/route.ts|requireCapability|dashboard.view.self,/portal/checkin",
    "app/portal/command/cloud/page.tsx|requireCommandCenter|/portal/command/cloud,command.cloud",
    "app/portal/command/lodge/page.tsx|requireCapability|dashboard.view.self,/portal/command/lodge",
    "app/portal/command/page.tsx|requireCommandCenter|/portal/command,command.view",
    "app/portal/command/personal/page.tsx|requireFounder|/portal/command/personal,command.personal.view",
    "app/portal/commission/document/route.ts|requireCapability|dashboard.view.self,/portal/commission/document",
    "app/portal/commission/page.tsx|requireCapability|dashboard.view.self,/portal/commission",
    "app/portal/dialer/page.tsx|requireFounder|/portal/dialer,calls.dial",
    "app/portal/gallery/page.tsx|requireCapability|dashboard.view.self,/portal/gallery",
    "app/portal/inbound/page.tsx|requireCapability|calls.answer,/portal/inbound",
    "app/portal/investigator/page.tsx|requireFounder|/portal/investigator,investigator.view",
    "app/portal/leaderboard/page.tsx|requireCapability|dashboard.view.self,/portal/leaderboard",
    "app/portal/leadership/page.tsx|requireCapability|leadership.view.all,/portal/leadership",
    "app/portal/leadtech/page.tsx|requireCapability|leadership.view.all,/portal/leadtech",
    "app/portal/library/page.tsx|requireCapability|dashboard.view.self,/portal/library",
    "app/portal/members/page.tsx|requireCapability|members.view,/portal/members",
    "app/portal/music/page.tsx|requireCapability|dashboard.view.self,/portal/music",
    "app/portal/page.tsx|requireCapability|dashboard.view.self,/portal",
    "app/portal/pay-rates/page.tsx|requireCapability|leadership.view.all,/portal/pay-rates",
    "app/portal/quoter/page.tsx|requireCapability|book.view.self,/portal/quoter",
    "app/portal/retreaver/page.tsx|requireCapability|leadership.view.all,/portal/retreaver",
    "app/portal/scripts/page.tsx|requireCapability|scripts.manage,/portal/scripts",
    "app/portal/shop/page.tsx|requireCapability|dashboard.view.self,/portal/shop",
    "app/portal/stats/page.tsx|requireCapability|dashboard.view.self,/portal/stats",
    "app/portal/team/page.tsx|requireCapability|team.view,/portal/team",
    "app/portal/tools/page.tsx|requireCapability|dashboard.view.self,/portal/tools",
    "app/portal/training/page.tsx|requireCapability|dashboard.view.self,/portal/training",
    "app/portal/twilio/page.tsx|requireCapability|leadership.view.all,/portal/twilio",
    // Added with the AI usage widget. New guarded surface at the floor
    // capability every member already holds, so it widens no one's reach. The
    // provider behind it is deliberately unavailable — every field returns
    // "unavailable" rather than a guessed counter — so the route exposes no
    // member or account data today. Reviewed as a governance change, not
    // slipped in as a nit; if a real usage bridge is ever connected, the
    // capability on this route must be reconsidered at that time.
    "app/portal/usage/route.ts|requireCapability|dashboard.view.self,/portal/usage",
  ], "a guard call site changed — this is an access-model change and needs its own review");

  // The capability matrix is pinned byte for byte. It changed ONCE on
  // 2026-09-02 by owner direction: `book.edit.self` joined exactly the roles
  // that hold `book.view.self` (owner, admin, manager, agent), so a member
  // can enter their own book. Any other change re-pins here on purpose.
  const access = await readFile(new URL("../app/portal/access.ts", import.meta.url), "utf8");
  const matrix = access.slice(access.indexOf("const ROLE_CAPABILITIES"), access.indexOf("};", access.indexOf("const ROLE_CAPABILITIES")) + 2);
  const { createHash } = await import("node:crypto");
  assert.equal(
    createHash("sha256").update(matrix).digest("hex"),
    "fc41e59d150f477ec870c45d0e8b1d8435eae8d3d9443e51932a18922138e403",
    "ROLE_CAPABILITIES changed — capabilities are governance, not a menu convenience",
  );
  for (const role of ["owner", "admin", "manager", "agent"]) {
    const block = matrix.slice(matrix.indexOf(`${role}: [`), matrix.indexOf("]", matrix.indexOf(`${role}: [`)));
    assert.match(block, /"book\.view\.self",\s*"book\.edit\.self",/, `${role} edits exactly the book it can view`);
  }
  for (const role of ["reviewer", "support"]) {
    const block = matrix.slice(matrix.indexOf(`${role}: [`), matrix.indexOf("]", matrix.indexOf(`${role}: [`)));
    assert.doesNotMatch(block, /book\./, `${role} holds no book capability at all`);
  }
});

test("the Script Vault library holds all 18 source tabs, in order, every one a labelled draft", async () => {
  const { CALL_SCRIPTS, SCRIPT_STATUS_LABELS, SCRIPT_VAULT_SOURCE } = await import(
    new URL("../app/portal/scripts/library.ts", import.meta.url).href
  );
  const { plainText, formatBody } = await import(new URL("../app/portal/scripts/format.ts", import.meta.url).href);
  const { SCRIPT_VAULT_SOURCE_URL } = await import(new URL("../app/portal/scripts/source.ts", import.meta.url).href);

  assert.deepEqual(
    CALL_SCRIPTS.map((s) => s.title),
    [
      "Direct Carrier Question Intro",
      "Client States Problem First Intro",
      "Death Claim Discovery Intro",
      "Non life Discovery Intro",
      "Cancelation intro",
      "Quote Shopper Intro for CS calls",
      "Intro Tips and Tricks",
      "Standard To Preferred",
      "Term To perm",
      "Cash Surrender",
      "Loan Forgiveness",
      "Death Claim Extension",
      "Non Insurance Extension",
      "Consolidation",
      "Work Policy",
      "Quote Shopper Angle",
      "Three Option Close",
      "Billing page",
    ],
    "the 18 sections must be the source document's 18 top-level tabs, in its order",
  );
  assert.deepEqual(CALL_SCRIPTS.map((s) => s.order), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(new Set(CALL_SCRIPTS.map((s) => s.id)).size, 18, "ids are unique");
  for (const script of CALL_SCRIPTS) {
    assert.equal(script.status, "draft_compliance_review", `${script.title} must be a draft`);
    assert.equal(script.sourceTab, script.title, `${script.title} must name its source tab`);
    assert.ok(script.body.trim().length > 200, `${script.title} must carry its full body, not a stub`);
    assert.ok(!script.body.includes("\\_"), `${script.title} must have the export's backslash escapes decoded`);
    // The projection is stable and never longer than the body: markers are
    // removed, never added.
    const plain = plainText(script.body);
    assert.ok(plain.length <= script.body.length && plain.length > 0);
    assert.equal(plainText(plain), plain, "plainText is idempotent — a second pass changes nothing");
    assert.equal(formatBody(script.body).length, script.body.split("\n").length, "one formatted line per source line");
  }
  assert.equal(SCRIPT_STATUS_LABELS.draft_compliance_review, "DRAFT / LICENSED AND COMPLIANCE REVIEW REQUIRED");
  assert.equal(SCRIPT_VAULT_SOURCE.url, SCRIPT_VAULT_SOURCE_URL, "the server module and the client-safe URL module name the same document");
  assert.equal(SCRIPT_VAULT_SOURCE.documentId, "1vV2_B6xix29g-k-IVpXZR5AcTcyjhjlx4S-tJca97WE");

  // The formatter's contract on hand-picked shapes from the export.
  assert.equal(plainText("**STEP 1 — Reassure**"), "STEP 1 — Reassure");
  assert.equal(plainText("# **TERM TO PERM ANGLE**"), "TERM TO PERM ANGLE");
  assert.equal(plainText("### SCRIPT"), "SCRIPT");
  assert.equal(plainText("*PURPOSE:**  "), "*PURPOSE:**  ", "an unbalanced marker run is shown, not eaten");
  // Every blank the export rendered as `$***` survives, in every body: the
  // rule may never read a placeholder as a marker pair.
  for (const script of CALL_SCRIPTS) {
    for (const line of script.body.split("\n")) {
      const blanks = (line.match(/\$\*\*\*/g) ?? []).length;
      if (blanks) assert.equal((plainText(line).match(/\$\*\*\*/g) ?? []).length, blanks, `${script.title}: a $*** blank was eaten in: ${line}`);
    }
  }
  assert.equal(
    plainText("“Well ***, I'm assuming if you knew you could have **received a tax-free check for around $*** and still”"),
    "“Well ***, I'm assuming if you knew you could have **received a tax-free check for around $*** and still”",
    "a pair that would swallow a blank is not a pair",
  );
  assert.equal(plainText("• Secure their own **life insurance protection****  "), "• Secure their own **life insurance protection****  ", "a run touching another asterisk is left alone");
  assert.equal(plainText("**(pause 3 seconds)**"), "(pause 3 seconds)");
  assert.equal(plainText("*This reveals the issue* ***did not*** plain"), "This reveals the issue did not plain");

  // Server-only: the bodies must never reach a client bundle.
  const library = await readFile(new URL("../app/portal/scripts/library.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/portal/scripts/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(`${library}\n${page}`, /^["']use client["'];/m);
  assert.match(page, /requireCapability\("scripts\.manage", "\/portal\/scripts"\)/, "the Script Vault keeps its literal guard");
  assert.match(page, /SCRIPT_STATUS_LABELS\[script\.status\]/, "every card renders the draft label from the one source of truth");
  // Nothing in the vault may claim approval.
  assert.doesNotMatch(library, /"approved"/, "no imported script may be marked approved");
});

test("the Dialer's temporary script bridge is a plain external anchor inside the founder-gated panel, and nothing more", async () => {
  const dialer = await readFile(new URL("../app/portal/dialer/collab-dialer.tsx", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/portal/scripts/source.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/portal/calls/workspace.tsx", import.meta.url), "utf8");

  const anchor = dialer.match(/<a\s+className="dialer-button secondary dialer-script-bridge-link"[\s\S]*?<\/a>/);
  assert.ok(anchor, "the bridge must render as a plain <a>");
  assert.match(anchor[0], /href=\{SCRIPT_VAULT_SOURCE_URL\}/, "the bridge links the one canonical document constant");
  assert.match(anchor[0], /target="_blank"/);
  assert.match(anchor[0], /rel="noopener noreferrer"/);
  assert.match(anchor[0], /Open Script Library \(Temporary Hybrid\)/, "the exact ordered label");
  assert.doesNotMatch(anchor[0], /onClick|onPointer|onMouse|fetch\(|send\(|getUserMedia|originate|record/i, "the bridge has no handler and triggers nothing");
  assert.match(dialer, /Temporary; external; stores nothing here\./, "the panel says it is temporary and external");
  assert.match(source, /^export const SCRIPT_VAULT_SOURCE_URL =\s*\n?\s*"https:\/\/docs\.google\.com\/document\/d\/1vV2_B6xix29g-k-IVpXZR5AcTcyjhjlx4S-tJca97WE";/m);
  assert.doesNotMatch(source, /^import /m, "the client-safe URL module imports nothing — never the script bodies");
  // The only fetch in the dialer is the pre-existing originate call; the
  // bridge added none.
  assert.equal((dialer.match(/fetch\(/g) ?? []).length, 1, "the dialer still makes exactly one fetch — originate — and the bridge added none");
  // The Dialer guard is untouched: the panel renders only under outboundAuthorized.
  assert.match(workspace, /\{outboundAuthorized \? \(\s*<div className="calls-outbound-panel"[\s\S]*?<CollabDialer \/>/, "the CollabDialer stays inside the founder-authorized outbound panel");
});


/* ────────────────────────────────────────────────────────────────────────
 * Navigation placement + dock destinations (Dispatch R3, 2026-09-02) —
 * source-level pins. Three files carry the placement rule by hand because
 * the boot script runs before React exists and cannot import:
 * app/nav-placement.ts (the resolver), app/portal-chrome.tsx (the boot),
 * app/nav-control.tsx (the control); app/globals.css carries the width at
 * which a stored rail is honoured. These tests pin the four against each
 * other, prove the resolver fail-closed, and pin the dock tuple, the
 * demotion of Calls, the inert dialer, and the Book drawer id check.
 * Runtime counterparts live in portal-authorization.test.mjs.
 * ──────────────────────────────────────────────────────────────────────── */
const r3src = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("the resolver honours exactly one stored value, and only at desktop widths", async () => {
  const {
    DEFAULT_NAV_PLACEMENT,
    NAV_PLACEMENTS,
    NAV_PLACEMENT_STORAGE_KEY,
    NAV_RAIL_MIN_WIDTH,
    resolveNavPlacement,
    storedNavPlacement,
  } = await import(new URL("../app/nav-placement.ts", import.meta.url).href);

  assert.deepEqual([...NAV_PLACEMENTS], ["dock", "rail"]);
  assert.equal(DEFAULT_NAV_PLACEMENT, "dock");
  assert.equal(NAV_PLACEMENT_STORAGE_KEY, "core-portal-nav");
  assert.equal(NAV_RAIL_MIN_WIDTH, 960);

  // Stored value: exactly "rail" opts in. Everything else — including the
  // adversarial shapes a tampered localStorage can hold — is the dock.
  assert.equal(storedNavPlacement("rail"), "rail");
  for (const junk of [
    undefined,
    null,
    "",
    "dock",
    "Rail",
    "RAIL",
    " rail",
    "rail ",
    "rail\n",
    "sidebar",
    "left",
    1,
    true,
    {},
    [],
    ["rail"],
    "true",
    "__proto__",
    "constructor",
    "<script>rail</script>",
  ]) {
    assert.equal(storedNavPlacement(junk), "dock", `stored ${JSON.stringify(junk)} must fall back to the dock`);
  }

  // Viewport: the rail needs proof of width. Unknown, narrow, non-finite,
  // and negative widths all resolve to the dock; the boundary is inclusive.
  assert.equal(resolveNavPlacement("rail", 1440), "rail");
  assert.equal(resolveNavPlacement("rail", 960), "rail", "the breakpoint itself honours the rail");
  assert.equal(resolveNavPlacement("rail", 959), "dock", "one pixel under the breakpoint is the dock");
  assert.equal(resolveNavPlacement("rail", 390), "dock");
  assert.equal(resolveNavPlacement("rail", null), "dock", "no viewport (server) is the dock");
  assert.equal(resolveNavPlacement("rail", Number.NaN), "dock");
  assert.equal(resolveNavPlacement("rail", Number.POSITIVE_INFINITY), "dock", "a non-finite width is not a measured viewport");
  assert.equal(resolveNavPlacement("rail", -1), "dock");
  assert.equal(resolveNavPlacement("dock", 1440), "dock");
  assert.equal(resolveNavPlacement("junk", 1440), "dock");
  assert.equal(resolveNavPlacement(undefined, 1440), "dock");
});

test("the boot script, the control, and the stylesheet agree on the placement rule", async () => {
  const boot = await r3src("../app/portal-chrome.tsx");
  const control = await r3src("../app/nav-control.tsx");
  const resolver = await r3src("../app/nav-placement.ts");
  const css = (await r3src("../app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  // Storage key, duplicated by hand in the boot (it cannot import). A
  // mismatch is total placement amnesia.
  assert.match(boot, /PORTAL_NAV_STORAGE_KEY = "core-portal-nav"/);
  assert.match(control, /const STORAGE_KEY: typeof NAV_PLACEMENT_STORAGE_KEY = "core-portal-nav"/);
  assert.match(resolver, /NAV_PLACEMENT_STORAGE_KEY = "core-portal-nav"/);

  // Boot: reads the key inside the same pre-paint try block as the theme,
  // honours exactly "rail", and writes the PREFERENCE to data-portal-nav.
  // No viewport test in the boot — that is the stylesheet's job, below.
  assert.match(
    boot,
    /var n=localStorage\.getItem\("\$\{PORTAL_NAV_STORAGE_KEY\}"\);d\.dataset\.portalNav=n==="rail"\?"rail":"dock"\}catch\(e\)\{\}/,
    "the boot must restore the nav preference before first paint with the exact rail|dock rule",
  );
  assert.doesNotMatch(boot, /innerWidth|matchMedia/, "the boot never decides the viewport; CSS does");

  // Control: the server snapshot is the dock (what the boot paints for a
  // first-time visitor), and the DOM read goes through the shared validator.
  assert.match(control, /useSyncExternalStore\(subscribe, readPlacement, \(\) => DEFAULT_NAV_PLACEMENT\)/);
  assert.match(control, /storedNavPlacement\(document\.documentElement\.dataset\.portalNav\)/);
  assert.match(control, /^"use client";/m);
  assert.doesNotMatch(control, /from "\.\/portal\/access"/, "the control must never import the server-only access module");

  // Stylesheet: every rail rule lives inside a min-width media block at the
  // resolver's breakpoint, and the control hides one pixel below it. A rail
  // rule outside that block would honour a stored rail on a phone.
  const railRules = [...css.matchAll(/html\[data-portal-nav="rail"\]/g)];
  assert.ok(railRules.length >= 4, "the rail is styled by more than one rule");
  const wide = css.indexOf("@media (min-width: 960px) {\n  html[data-portal-nav=\"rail\"]");
  assert.ok(wide >= 0, "the rail block must open with @media (min-width: 960px)");
  // Find the closing brace of that media block by depth-counting.
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf("{", wide); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end > wide, "the rail media block does not close");
  const outside = css.slice(0, wide) + css.slice(end + 1);
  assert.doesNotMatch(outside, /data-portal-nav="rail"/, "a rail rule exists outside the desktop media block");
  assert.match(css, /@media \(max-width: 959px\) \{\s*\.portal-nav-control \{ display: none; \}/, "the control hides below the rail breakpoint");

  // The base dock rule is untouched in the two ways the older pin measures.
  const dock = css.match(/(?:^|\n)\.portal-dock \{([^}]*)\}/);
  assert.ok(dock);
  assert.match(dock[1], /position:\s*fixed/);
  assert.match(dock[1], /env\(safe-area-inset-bottom\)/);
});

test("the dock carries five destinations, all of them menu rows, and Calls is not one of them", async () => {
  const components = await r3src("../app/portal/components.tsx");

  const declared = components.match(/export const DOCK_DESTINATIONS = \[([^\]]+)\] as const;/);
  assert.ok(declared, "DOCK_DESTINATIONS must stay an exported literal tuple");
  const dock = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(dock, ["/portal", "/portal/book", "/portal/inbound", "/portal/team", "/portal/leadership"]);

  // Every destination is a NAV row with a dockLabel, so the dock can never
  // carry a door the menu lacks and every slot has its short word.
  const nav = components.slice(components.indexOf("const NAV: readonly NavItem[]"), components.indexOf("function visibleNav("));
  const expectedLabels = { "/portal": "Today", "/portal/book": "Book", "/portal/inbound": "Inbound", "/portal/team": "Team", "/portal/leadership": "Leadership" };
  for (const href of dock) {
    const at = nav.indexOf(`href: "${href}",`);
    assert.ok(at >= 0, `${href} must be a NAV row`);
    const entry = nav.slice(at, nav.indexOf("},", at));
    assert.match(entry, new RegExp(`dockLabel: "${expectedLabels[href]}"`), `${href} carries dockLabel ${expectedLabels[href]}`);
  }

  // The dock renders from that tuple and from the SAME filtered list as the
  // menu; the retired quick-link literal must be gone.
  assert.match(components, /\{DOCK_DESTINATIONS\.map\(\(href\) => \{\s*const item = visible\.find\(\(entry\) => entry\.href === href\);\s*if \(!item\) return null;/);
  assert.doesNotMatch(components, /\["\/portal", "\/portal\/calls", "\/portal\/music"\]/, "the old Today/Calls/Radio quick-link tuple must be retired");

  // Calls keeps its menu row and its guard; it only left the dock. The
  // Inbound row is the panel's door and shares the calls.answer guard.
  const calls = nav.slice(nav.indexOf('href: "/portal/calls",'), nav.indexOf("},", nav.indexOf('href: "/portal/calls",')));
  assert.match(calls, /capability: "calls\.answer"/);
  assert.doesNotMatch(calls, /dockLabel/, "Calls must carry no dock slot");
  const inbound = nav.slice(nav.indexOf('href: "/portal/inbound",'), nav.indexOf("},", nav.indexOf('href: "/portal/inbound",')));
  assert.match(inbound, /capability: "calls\.answer"/);
  assert.match(inbound, /group: "Today"/);

  // The deferred dialer: inert by construction — a span with no href and no
  // handler, rendered only inside the founder branch.
  const deferred = components.slice(components.indexOf("{founder ? (\n            <span\n              className=\"portal-dock-deferred\""), components.indexOf(") : null}", components.indexOf('className="portal-dock-deferred"')));
  assert.ok(deferred.length > 0, "the deferred dialer slot must be rendered inside the founder branch");
  assert.doesNotMatch(deferred, /href=|onClick|<Link|<a |<button/, "the deferred dialer must be inert");
  assert.match(deferred, /aria-disabled="true"/);
  assert.match(deferred, /portal-pill-deferred">Deferred</);
});

test("the Book drawer accepts only a small integer id and the panel views are a closed set", async () => {
  const book = await r3src("../app/portal/book/page.tsx");
  assert.match(book, /requireCapability\("book\.view\.self", "\/portal\/book"\)/, "the Book keeps its literal guard");
  assert.match(book, /\/\^\\d\{1,9\}\$\/\.test\(value\)/, "customer ids are validated as small positive integers before any use");
  assert.match(book, /customers\.find\(\(row\) => row\.id === requestedId\)/, "the drawer opens only for an id inside the member's own loaded list — no second query");
  assert.match(book, /const VIEWS = \["summary", "customers", "policies"\] as const;/);
  assert.doesNotMatch(book, /getDb\(\)/, "the Book page runs no query of its own; it reuses the self-scoped loaders");
  assert.match(book, /can\(session, "book\.edit\.self"\)/, "the entry forms render only for a role that may write");
  // The two write routes: same-origin, capability-asserted, self-scoped,
  // and they keep no full phone or policy number.
  const customers = await r3src("../app/portal/book/customers/route.ts");
  const policies = await r3src("../app/portal/book/policies/route.ts");
  for (const [name, route] of [["customers", customers], ["policies", policies]]) {
    assert.match(route, /assertCapability\(session, "book\.edit\.self"/, `${name}: the write asserts book.edit.self`);
    assert.match(route, /if \(!isSameOrigin\(request\)\)/, `${name}: cross-origin posts are refused`);
    assert.match(route, /memberId: session\.memberId/, `${name}: the row's owner is the session's own member, never a field`);
    assert.doesNotMatch(route, /form\.get\("member_id"\)|field\(form, "member_id"\)/, `${name}: no member_id is ever read from the body`);
  }
  assert.match(customers, /phoneMasked = `\*\*\*-\*\*\*-\$\{phoneLast4\}`/, "the phone is masked before it is stored");
  assert.doesNotMatch(customers, /phone: phoneRaw|phoneRaw\b[^;]*values/, "the raw phone never reaches the insert");
  assert.match(policies, /policyLast4 = numberRaw === "" \? null : numberRaw\.slice\(-4\)/, "only the last four of a policy number are kept");
  assert.match(policies, /await ownsCustomer\(session, policy\.customerId\)/, "a policy attaches only to the member's own customer");
  assert.match(policies, /eq\(bookPolicies\.memberId, session\.memberId\)/, "a status change is scoped to the member's own rows");
  // The inbound panel likewise keeps its guard literal and reads only self-scoped rows.
  const inbound = await r3src("../app/portal/inbound/page.tsx");
  assert.match(inbound, /requireCapability\("calls\.answer", "\/portal\/inbound"\)/);
  assert.match(inbound, /eq\(voicePresence\.memberId, session\.memberId\)/, "presence is read for the session's own member only");
  assert.doesNotMatch(inbound, /redirect\(/, "the route renders the panel now; it no longer redirects into Calls");
});
