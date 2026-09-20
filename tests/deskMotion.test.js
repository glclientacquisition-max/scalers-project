const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

/** Lockstep with dashboard/src/lib/deskMotion.ts */
const DESK_LAND_MAX_FRESH = 3;
function nextLandedIds(seen, incoming, reset = false) {
  if (seen === null || reset) {
    return { seen: new Set(incoming), landed: [] };
  }
  const landed = [];
  for (const id of incoming) {
    if (!seen.has(id)) landed.push(id);
  }
  const next = new Set(seen);
  for (const id of incoming) next.add(id);
  if (landed.length > DESK_LAND_MAX_FRESH) {
    return { seen: next, landed: [] };
  }
  return { seen: next, landed };
}

describe("desk land helper", () => {
  it("never lands the first paint", () => {
    const first = nextLandedIds(null, ["a", "b", "c"]);
    assert.deepEqual(first.landed, []);
    assert.equal(first.seen.size, 3);
  });

  it("lands a live insert of one or two ids", () => {
    const seeded = nextLandedIds(null, ["a", "b"]);
    const one = nextLandedIds(seeded.seen, ["n", "a", "b"]);
    assert.deepEqual(one.landed, ["n"]);
    const two = nextLandedIds(one.seen, ["n", "m", "a", "b"]);
    assert.deepEqual(two.landed, ["m"]);
  });

  it("does not flash a filter or page swap", () => {
    const seeded = nextLandedIds(null, ["a"]);
    const swapped = nextLandedIds(seeded.seen, ["w", "x", "y", "z"]);
    assert.deepEqual(swapped.landed, []);
    assert.equal(swapped.seen.has("z"), true);
  });

  it("reseeds on scope reset", () => {
    const seeded = nextLandedIds(null, ["a"]);
    const reset = nextLandedIds(seeded.seen, ["n"], true);
    assert.deepEqual(reset.landed, []);
    assert.equal(reset.seen.has("a"), false);
    assert.equal(reset.seen.has("n"), true);
  });
});

describe("desk motion canon", () => {
  const motion = read("dashboard/src/lib/deskMotion.ts");
  const css = read("dashboard/src/app/globals.css");
  const land = read("dashboard/src/components/ui/DeskLand.tsx");
  const row = read("dashboard/src/components/ui/deskRow.tsx");
  const chrome = read("dashboard/src/components/ui/deskChrome.ts");
  const master = read("docs/frontend/design-system/MASTER.md");
  const constitution = read("docs/frontend/FRONTEND_CONSTITUTION.md");
  const skill = read(".cursor/skills/desk-motion/SKILL.md");

  it("keeps the land helper in lockstep with deskMotion.ts", () => {
    assert.match(motion, /export const DESK_LAND_MS = 900/);
    assert.match(motion, /export const DESK_LAND_MAX_FRESH = 3/);
    assert.match(motion, /if \(seen === null \|\| reset\)/);
    assert.match(motion, /landed\.length > DESK_LAND_MAX_FRESH/);
    assert.match(motion, /export const deskLivePingClass = "desk-live-ping"/);
    assert.match(motion, /export const deskShiftClass/);
    assert.match(motion, /export const deskJustLandedClass = "desk-just-landed"/);
  });

  it("names desk verbs and kills them under reduced motion", () => {
    assert.match(css, /--motion-fast: 150ms/);
    assert.match(css, /--motion-land: 900ms/);
    assert.match(css, /@keyframes desk-live-ping/);
    assert.match(css, /@keyframes desk-land-fade/);
    assert.match(css, /\.desk-live-ping/);
    assert.match(css, /background: var\(--accent-soft\)/);
    assert.match(css, /box-shadow: inset 3px 0 0 var\(--accent\)/);
    const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduce, /\.desk-live-ping/);
    assert.match(reduce, /\.desk-just-landed/);
    assert.match(reduce, /\.desk-shift/);
    assert.match(reduce, /\.landing-rise/);
    assert.match(reduce, /\.landing-drift/);
    assert.match(master, /\*\*pending\*\*/);
    assert.match(master, /\*\*live\*\*/);
    assert.match(master, /\*\*land\*\*/);
    assert.match(master, /\*\*shift\*\*/);
    assert.match(master, /\*\*press\*\*/);
    assert.match(constitution, /Desk motion verbs/);
    assert.match(skill, /pending.*live.*land.*shift.*press/s);
  });

  it("ships LivePing, land scope, and pending spinner", () => {
    assert.match(row, /export function LivePing/);
    assert.match(row, /desk-live-ping/);
    assert.match(land, /export function DeskLandScope/);
    assert.match(land, /export function DeskLandSurface/);
    assert.match(land, /scopeKey/);
    assert.match(chrome, /pendingSpinnerClass/);
    assert.match(chrome, /deskShiftClass/);
    assert.match(chrome, /motion-reduce:animate-none/);
    assert.match(chrome, /motion-reduce:active:scale-100/);
  });

  it("does not install a motion-graphics stack", () => {
    const pkg = read("dashboard/package.json");
    assert.doesNotMatch(pkg, /lottie|framer-motion|gsap|animate\.css/i);
    assert.doesNotMatch(land, /landing-rise|landing-drift/);
    assert.doesNotMatch(row, /landing-rise|animate-pulse/);
  });
});

describe("desk motion wiring", () => {
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const dialog = read("dashboard/src/components/ui/DeskDialog.tsx");
  const catalogPage = read("dashboard/src/app/dev/motion/page.tsx");
  const catalog = read("dashboard/src/app/dev/motion/MotionCatalog.tsx");

  it("lands Inbox rows that appear while watching", () => {
    assert.match(calls, /<DeskLandScope/);
    assert.match(calls, /scopeKey=\{`\$\{activeFilter\}:\$\{page\}:\$\{q\}`\}/);
    assert.match(inbox, /item\.purpose === "live"/);
    assert.match(inbox, /RowStateDot show=\{item\.unread\} live=/);
    const swipe = read("dashboard/src/components/InboxPileSwipe.tsx");
    assert.match(swipe, /deskShiftClass/);
    assert.doesNotMatch(swipe, /transition-all|framer-motion/);
  });

  it("lands Contacts rows on the same live refresh", () => {
    assert.match(contacts, /<DeskLandScope/);
    assert.match(contacts, /<DeskLandSurface/);
    assert.match(contacts, /scopeKey=\{`\$\{saved\}:\$\{page\}`\}/);
  });

  it("pings the Home bulletin and keeps dialogs enter-static", () => {
    assert.match(home, /<LivePing/);
    assert.match(dialog, /No enter animation/);
    assert.doesNotMatch(dialog, /landing-rise|animate-|transition-opacity|scale-/);
  });

  it("exposes a gated catalog of the motion verbs", () => {
    assert.match(catalogPage, /DASHBOARD_OPEN/);
    assert.match(catalog, /pendingSpinnerClass/);
    assert.match(catalog, /LivePing/);
    assert.match(catalog, /DeskLandScope/);
    assert.match(catalog, /Shift/);
    assert.match(catalog, /deskShiftClass/);
    assert.match(catalog, /btnPrimary/);
  });

  it("shifts Inbox and Home chrome with named properties", () => {
    assert.match(inbox, /deskShiftClass/);
    assert.doesNotMatch(inbox, /transition duration-150/);
    assert.match(home, /deskShiftClass/);
    assert.match(contacts, /deskShiftClass/);
    const nav = read("dashboard/src/components/DeskNav.tsx");
    assert.match(nav, /deskShiftClass/);
  });

  it("replaces leftover duration-150 and transition-all with deskShiftClass", () => {
    const tenant = read("dashboard/src/components/TenantForm.tsx");
    const onboard = read("dashboard/src/app/onboarding/OnboardingWizard.tsx");
    assert.match(tenant, /deskShiftClass/);
    assert.doesNotMatch(tenant, /transition duration-150/);
    assert.match(onboard, /deskShiftClass/);
    assert.doesNotMatch(onboard, /transition-all/);
    assert.match(read("dashboard/src/components/LeadStatusToggle.tsx"), /deskShiftClass/);
    assert.match(read("dashboard/src/components/CallFaqSuggestions.tsx"), /btnPrimary/);
  });

  it("spins the Inbox SMS polish wand with pending ink", () => {
    const dock = read("dashboard/src/components/InboxSmsDock.tsx");
    assert.match(dock, /pendingSpinnerInkClass/);
    assert.match(dock, /polishPending/);
    assert.match(dock, /pendingSpinnerClass/);
    assert.match(dock, /sendPending/);
    assert.doesNotMatch(dock, /animate-pulse/);
  });

  it("spins Ping teammate with pending while notify is in flight", () => {
    const ping = read("dashboard/src/components/InboxPingTeammate.tsx");
    assert.match(ping, /pendingSpinnerClass/);
    assert.doesNotMatch(ping, /animate-pulse/);
    assert.doesNotMatch(ping, /transition-all/);
  });
});
