const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () => import(path.join(root, "dashboard/src/lib/ops/settingsHubView.ts"));

test("reads the #885 hold columns: switch On/Off, number hold days, fee Not set when null", async () => {
  const { holdSettings } = await load();
  const h = Object.fromEntries(holdSettings({ voicemail_hold_days: 7, hold_winback_enabled: true, number_hold_days: 14, reactivation_fee_kes: null, holdColumns: true }).map((v) => [v.label, v]));
  assert.equal(h["Hold switch"].value, "On");
  assert.equal(h["Number hold"].value, "14 days");
  assert.equal(h["Voicemail window"].value, "7 days");
  assert.equal(h["Reactivation fee"].value, "Not set");
  assert.equal(holdSettings({ hold_winback_enabled: false, reactivation_fee_kes: 1500, holdColumns: true }).find((v) => v.label === "Reactivation fee").value, "KSh 1,500");
  assert.equal(holdSettings({ hold_winback_enabled: false, holdColumns: true })[0].value, "Off");
});

test("columns missing (prod): Not on this environment, never invented values or placeholders", async () => {
  const { holdSettings, billingSwitches } = await load();
  for (const raw of [null, { voicemail_hold_days: 7, holdColumns: false }]) {
    const h = holdSettings(raw);
    for (const l of ["Hold switch", "Number hold", "Reactivation fee"]) {
      const v = h.find((x) => x.label === l);
      assert.equal(v.value, "Not on this environment");
      assert.equal(v.state, "absent");
    }
    assert.ok(h.every((v) => !/30 days|placeholder/i.test(`${v.value} ${v.note}`)));
  }
  assert.ok(billingSwitches(null).every((v) => v.value === "Not set" && v.state === "missing"));
});

test("loader asks for the hold columns and flags when they are missing", () => {
  const load = fs.readFileSync(path.join(root, "dashboard/src/lib/adminSettingsHubLoad.ts"), "utf8");
  assert.match(load, /hold_winback_enabled, number_hold_days, reactivation_fee_kes/);
  assert.match(load, /holdColumns: false/);
});

test("hub page is ADMIN_V2 only and read-only", () => {
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/admin/(console)/settings/general/page.tsx"), "utf8");
  const ui = fs.readFileSync(path.join(root, "dashboard/src/components/admin/v2/AdminSettingsHubV2.tsx"), "utf8");
  assert.match(page, /ADMIN_V2 !== "on"\) notFound\(\)/);
  assert.doesNotMatch(ui, /<form|onSubmit|action=|bachs/i);
});
