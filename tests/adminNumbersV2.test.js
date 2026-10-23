const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = () => import(path.join(root, "dashboard/src/lib/ops/numbersView.ts"));
const now = new Date("2026-10-22T09:00:00Z");
const n = (o) => ({ id: "1", e164: "+254709100201", status: "available", businessId: null, businessName: null, businessActive: null,
  assignedAt: null, createdAt: "2026-01-01T00:00:00Z", notes: null, holdUntil: null, heldAt: null, lastBusinessId: null, lastBusinessName: null, ...o });

test("an expired hold counts as available; a live hold as on hold", async () => {
  const { numberState } = await load();
  assert.equal(numberState(n({ status: "quarantine", holdUntil: "2026-10-01T00:00:00Z" }), now), "available");
  assert.equal(numberState(n({ status: "quarantine", holdUntil: "2026-11-01T00:00:00Z" }), now), "held");
  assert.equal(numberState(n({ status: "reserved" }), now), "held");
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

test("Numbers v2 is behind ADMIN_V2, Assign/Release write via OpsConfirm, Unlock/Hold stay honest", () => {
  const page = read("dashboard/src/app/admin/(console)/numbers/page.tsx");
  assert.match(page, /ADMIN_V2 === "on"/);
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /OpsConfirm/);
  assert.match(ui, /confirmLabel="Assign number"/);
  assert.match(ui, /confirmLabel="Release number"/);
  assert.match(ui, /strength="destructive"/);
  assert.match(ui, /method: "POST"/);
  assert.match(ui, /\/api\/did-pool/);
  assert.match(ui, /data-honest="unlock"/);
  assert.match(ui, /data-honest="hold"/);
  assert.match(ui, /Secure sign-in is next/);
  // Unlock/Hold must not POST — only Assign/Release call postPool / fetch.
  const honest = ui.split("data-honest");
  assert.ok(honest.length >= 3);
  for (const chunk of honest.slice(1)) {
    const end = chunk.indexOf("</Button>");
    const btn = chunk.slice(0, end);
    assert.doesNotMatch(btn, /postPool|fetch\(/);
  }
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

test("s22: UI wires Archive & release, Just release, and BusinessPane Archive via OpsConfirm", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /confirmLabel="Archive & release"/);
  assert.match(ui, /Just release/);
  assert.doesNotMatch(ui, /254709221536|Done and Dusted/);
  const pane = read("dashboard/src/components/admin/v2/BusinessPane.tsx");
  assert.match(pane, /confirmLabel="Archive business"/);
  assert.match(pane, /strength="destructive"/);
  assert.match(pane, /action: "archive"/);
});

test("s22: archive confirms show the Reason they require (never require what you don't show)", () => {
  const oc = read("dashboard/src/components/ops/OpsConfirm.tsx");
  assert.match(oc, /requireReason/);
  assert.match(oc, /needReason \? \(/);
  assert.match(oc, /Add a reason \(3 characters or more\)/);
  assert.match(oc, /reasonShort \|\|/);
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /strength="destructive"\n\s+requireReason/);
  assert.match(ui, /archiveThenRelease\(it\.businessId, it\.e164, reason\)/);
  const pane = read("dashboard/src/components/admin/v2/BusinessPane.tsx");
  assert.match(pane, /requireReason/);
  assert.match(pane, /business_id: businessId, reason \}/);
});
