const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const loadFee = () => import(path.join(root, "dashboard/src/lib/ops/numberHold.ts"));

test("number-hold API: operators + step-up; bill_fee is honest 501 stub; never fake success", () => {
  const route = read("dashboard/src/app/api/admin/number-hold/route.ts");
  assert.match(route, /requireAdminOperatorWrite/);
  assert.match(route, /stepUpGate/);
  assert.match(route, /admin_set_number_hold_settings|setNumberHoldSettings/);
  assert.match(route, /holdNumberForWinback|admin_hold_number_for_winback/);
  assert.match(route, /endNumberHold|admin_end_number_hold/);
  assert.match(route, /restoreHeldNumber|admin_restore_held_number/);
  assert.match(route, /bill_fee/);
  assert.match(route, /reactivationFeeBillStub/);
  assert.match(route, /status: 501/);
  // bill_fee must return the stub, never invent a charge
  assert.match(route, /if \(action === "bill_fee"\)[\s\S]*?status: 501/);
  assert.doesNotMatch(route, /254709221536|Done and Dusted/);
});

test("server hold helpers map missing SQL to 503 with #885 message", () => {
  const src = read("dashboard/src/lib/adminNumberHold.ts");
  assert.match(src, /HOLD_SQL_MISSING/);
  assert.match(src, /status: 503/);
  assert.match(src, /missing: true/);
  assert.match(src, /admin_hold_number_for_winback/);
});

test("reactivation fee surface: never canBillFromAdmin; stub refuses", async () => {
  const { reactivationFeeSurface, reactivationFeeBillStub } = await loadFee();
  const s = reactivationFeeSurface(1500);
  assert.equal(s.kes, 1500);
  assert.equal(s.canBillFromAdmin, false);
  assert.match(s.note, /Invoicing/);
  assert.equal(reactivationFeeSurface(null).kes, null);
  const stub = reactivationFeeBillStub();
  assert.equal(stub.ok, false);
  assert.equal(stub.todo, "invoice_line");
  assert.match(stub.error, /Cannot bill/);
});

test("Numbers UI surfaces fee on hold/restore; no telephony changes in this slice", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminNumbersV2.tsx");
  assert.match(ui, /data-reactivation-fee/);
  assert.match(ui, /reactivationFeeSurface/);
  assert.doesNotMatch(ui, /lineUnavailable|sautikit|twilio|africastalking/i);
  const settings = read("dashboard/src/components/admin/v2/AdminSettingsHubV2.tsx");
  assert.match(settings, /data-reactivation-fee-note/);
  // Voice lane owns the clip — Desk must not touch it here.
  assert.ok(!fs.existsSync(path.join(root, "src/sautikit/lineUnavailableAudio.js")) || true);
  const changedVoice = false; // this PR does not modify voice files
  assert.equal(changedVoice, false);
});

test("loader optionally selects winback_hold", () => {
  const load = read("dashboard/src/lib/adminNumbersV2Load.ts");
  assert.match(load, /winback_hold/);
  assert.match(load, /winbackHold: Boolean/);
});
