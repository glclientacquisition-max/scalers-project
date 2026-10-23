const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/numbersView.ts"));
const loadHold = () => import(path.join(root, "dashboard/src/lib/ops/numberHold.ts"));
const now = new Date("2026-10-22T09:00:00Z");
const n = (o) => ({ id: "1", e164: "+254709100201", status: "available", businessId: null, businessName: null, businessActive: null,
  assignedAt: null, createdAt: "2026-01-01T00:00:00Z", notes: null, holdUntil: null, heldAt: null, lastBusinessId: null, lastBusinessName: null, winbackHold: false, ...o });

test("an expired hold counts as available; a live hold as on hold", async () => {
  const { numberState, statusLabel } = await load();
  assert.equal(numberState(n({ status: "quarantine", holdUntil: "2026-10-01T00:00:00Z" }), now), "available");
  assert.equal(numberState(n({ status: "quarantine", holdUntil: "2026-11-01T00:00:00Z" }), now), "held");
  assert.equal(numberState(n({ status: "reserved" }), now), "held");
  assert.equal(statusLabel(n({ status: "quarantine", holdUntil: "2026-11-01T00:00:00Z", winbackHold: true }), now), "Win-back hold");
});

test("opens on Available only when someone is waiting", async () => {
  const { defaultNumberView } = await load();
  const rows = [n({}), n({ id: "2", status: "assigned" })];
  assert.equal(defaultNumberView(rows, 1, now), "available");
  assert.equal(defaultNumberView(rows, 0, now), "assigned");
});

test("search matches local digits and business names", async () => {
  const { matchesNumber, formatE164 } = await load();
  assert.equal(matchesNumber(n({}), "0709 100"), true);
  assert.equal(matchesNumber(n({ businessName: "Kesho Dental" }), "kesho"), true);
  assert.equal(formatE164("+254709100201"), "+254 709 100 201");
});

test("Numbers v2 is behind ADMIN_V2; Assign/Release/Hold write via OpsConfirm + number-hold API", () => {
  const page = read("dashboard/src/app/admin/(console)/numbers/page.tsx");
  assert.match(page, /ADMIN_V2 === "on"/);
  assert.match(page, /holdPolicyFromSettings/);
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /OpsConfirm/);
  assert.match(ui, /confirmLabel="Assign number"/);
  assert.match(ui, /strength="destructive"/);
  assert.match(ui, /\/api\/did-pool/);
  assert.match(ui, /\/api\/admin\/number-hold/);
  assert.match(ui, /data-action="start-hold"|data-action="end-hold"|data-action="restore-hold"/);
  assert.match(ui, /data-hold-choice/);
  assert.match(ui, /UnlockCta/);
  assert.doesNotMatch(ui, /254709221536|Done and Dusted/);
  for (const s of [ui, read("dashboard/src/lib/ops/numbersView.ts")]) assert.doesNotMatch(s, /sautikit|bachs|twilio|supabase|africastalking/i);
});

const loadAR = () => import(path.join(root, "dashboard/src/lib/ops/archiveRelease.ts"));

test("s22: live business offers Archive & release, Just release only when not blocked", async () => {
  const { releaseActions } = await loadAR();
  assert.deepEqual(releaseActions("assigned", "Archive first", "b1"), { archiveRelease: true, justRelease: false, justReleaseWhy: "Archive first" });
  assert.deepEqual(releaseActions("assigned", null, "b1"), { archiveRelease: false, justRelease: true, justReleaseWhy: null });
  assert.equal(releaseActions("available", null, null).justRelease, false);
  assert.equal(releaseActions("held", "x", "b1").archiveRelease, false);
});

test("s22: archive then release, in order, and says which step failed", async () => {
  const { archiveThenRelease } = await loadAR();
  const calls = [];
  const ok = (url, body) => { calls.push([url, body.action, body.reason]); return Promise.resolve({ ok: true }); };
  assert.deepEqual(await archiveThenRelease("b1", "+254700000001", "test tenant", ok), { ok: true });
  assert.deepEqual(calls, [["/api/admin/businesses", "archive", "test tenant"], ["/api/did-pool", "release", "test tenant"]]);
  const calls2 = [];
  const failA = (url) => { calls2.push(url); return Promise.resolve({ ok: false, error: "no" }); };
  const r1 = await archiveThenRelease("b1", "+254700000001", "why", failA);
  assert.equal(r1.step, "archive");
  assert.equal(calls2.length, 1);
  const failR = (url) => Promise.resolve({ ok: url.includes("businesses") });
  const r2 = await archiveThenRelease("b1", "+254700000001", "why", failR);
  assert.equal(r2.step, "release");
  assert.match(r2.error, /archived, but the number was not released/);
});

test("s28: release then maybe hold; hold failure after release is honest", async () => {
  const { releaseThenMaybeHold, archiveThenReleaseMaybeHold } = await loadAR();
  const calls = [];
  const ok = (url, body) => { calls.push([url, body.action, body.days ?? null]); return Promise.resolve({ ok: true }); };
  assert.deepEqual(await releaseThenMaybeHold("+254700000001", "why", "hold", 14, ok), { ok: true });
  assert.deepEqual(calls, [["/api/did-pool", "release", null], ["/api/admin/number-hold", "hold", 14]]);
  const free = [];
  await releaseThenMaybeHold("+254700000001", "why", "free", null, (url, body) => { free.push(body.action); return Promise.resolve({ ok: true }); });
  assert.deepEqual(free, ["release"]);
  const failHold = (url) => Promise.resolve({ ok: !url.includes("number-hold"), error: "off" });
  const r = await releaseThenMaybeHold("+254700000001", "why", "hold", 7, failHold);
  assert.equal(r.step, "hold");
  assert.match(r.error, /released, but win-back hold did not start/);
  const a = await archiveThenReleaseMaybeHold("b1", "+254700000001", "why", "hold", 14, ok);
  assert.equal(a.ok, true);
});

test("s22: UI wires Archive & release, Just release, and BusinessPane Archive via OpsConfirm", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /Archive &(?:amp;)? release|Archive, release and hold/);
  assert.match(ui, /Just release/);
  assert.doesNotMatch(ui, /254709221536|Done and Dusted/);
  const pane = read("dashboard/src/components/admin/v2/BusinessPane.tsx");
  assert.match(pane, /confirmLabel="Archive business"/);
  assert.match(pane, /strength="destructive"/);
  assert.match(pane, /action: "archive"/);
  assert.match(pane, /Number hold, end-early and restore live on Numbers/);
});

test("s22: archive confirms show the Reason they require (never require what you don't show)", () => {
  const oc = read("dashboard/src/components/ops/OpsConfirm.tsx");
  assert.match(oc, /requireReason/);
  assert.match(oc, /needReason \? \(/);
  assert.match(oc, /Add a reason \(3 characters or more\)/);
  assert.match(oc, /reasonShort \|\|/);
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /requireReason/);
  assert.match(ui, /archiveThenReleaseMaybeHold/);
  const pane = read("dashboard/src/components/admin/v2/BusinessPane.tsx");
  assert.match(pane, /requireReason/);
  assert.match(pane, /business_id: businessId, reason \}/);
});

test("s28: hold policy helpers — Off hides new holds; end/restore stay for running holds", async () => {
  const { numberHoldActions, holdPolicyFromSettings, clampHoldDays } = await loadHold();
  assert.equal(clampHoldDays(0), 1);
  assert.equal(clampHoldDays(100), 90);
  assert.equal(clampHoldDays(14), 14);
  const on = holdPolicyFromSettings({ holdColumns: true, hold_winback_enabled: true, number_hold_days: 14, reactivation_fee_kes: 1500 });
  assert.equal(on.enabled, true);
  assert.equal(on.reactivationFeeKes, 1500);
  const a = numberHoldActions({ state: "assigned", winbackHold: false, policy: on, lastBusinessId: "b1" });
  assert.equal(a.chooseOnRelease, true);
  assert.equal(a.startHold, false);
  const held = numberHoldActions({ state: "held", winbackHold: true, policy: on, lastBusinessId: "b1" });
  assert.equal(held.endHold, true);
  assert.equal(held.restore, true);
  const off = holdPolicyFromSettings({ holdColumns: true, hold_winback_enabled: false, number_hold_days: 14, reactivation_fee_kes: null });
  const aOff = numberHoldActions({ state: "assigned", winbackHold: false, policy: off, lastBusinessId: "b1" });
  assert.equal(aOff.chooseOnRelease, false);
  assert.match(aOff.whyOff, /Off in Settings/);
  const missing = holdPolicyFromSettings({ holdColumns: false });
  assert.equal(missing.columnsPresent, false);
  assert.match(numberHoldActions({ state: "held", winbackHold: true, policy: missing, lastBusinessId: "b1" }).whyOff, /#885/);
});
