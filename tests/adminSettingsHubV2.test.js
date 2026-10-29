const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () => import(path.join(root, "dashboard/src/lib/ops/settingsHubView.ts"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Number hold card: Hold after release On/Off, Hold length days, fee Not set when null", async () => {
  const { holdSettings } = await load();
  const h = Object.fromEntries(
    holdSettings({
      hold_winback_enabled: true,
      number_hold_days: 14,
      reactivation_fee_kes: null,
      holdColumns: true,
    }).map((v) => [v.label, v]),
  );
  assert.equal(Object.keys(h).length, 3);
  assert.equal(h["Hold after release"].value, "On");
  assert.equal(h["Hold length"].value, "14 days");
  assert.equal(h["Reactivation fee"].value, "Not set");
  assert.equal(holdSettings({ hold_winback_enabled: false, reactivation_fee_kes: 1500, holdColumns: true })[0].value, "Off");
  assert.equal(holdSettings({ hold_winback_enabled: false, reactivation_fee_kes: 1500, holdColumns: true }).find((v) => v.label === "Reactivation fee").value, "KSh 1,500");
});

test("columns missing: Not on this environment; never invent values or placeholders", async () => {
  const { holdSettings, NOT_HERE } = await load();
  for (const raw of [null, { holdColumns: false }, { voicemail_hold_days: 7, holdColumns: false }]) {
    const h = holdSettings(raw);
    assert.equal(h.length, 3);
    for (const v of h) {
      assert.equal(v.value, NOT_HERE);
      assert.equal(v.state, "absent");
    }
  }
});

test("hub UI: Unlock reveals edit form; Services/Voices/Audit are text links; no fake success", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminSettingsHubV2.tsx");
  assert.match(ui, /UnlockCta/);
  assert.match(read("dashboard/src/components/ops/UnlockCta.tsx"), /label = "Unlock"/);
  assert.match(ui, /View only · unlock to change/);
  assert.match(ui, /data-number-hold/);
  assert.match(ui, /data-hold-edit/);
  assert.match(ui, /data-field="hold-enabled"/);
  assert.match(ui, /data-field="reactivation-fee"/);
  assert.match(ui, /\/api\/admin\/number-hold/);
  assert.match(ui, /action: "set_settings"/);
  assert.match(ui, /OpsConfirm/);
  assert.doesNotMatch(ui, /Coming soon|billingSwitches/);
  assert.match(ui, /\/admin\/settings\/services/);
  assert.match(ui, /\/admin\/settings\/voices/);
  assert.match(ui, /\/admin\/settings\/audit/);
  assert.match(ui, /Also in Settings/);
  assert.match(ui, /How it works/);
  assert.match(ui, /reactivationFeeSurface|feeSurface\.note/);
});

test("loader asks for the hold columns and flags when they are missing", () => {
  const loadSrc = read("dashboard/src/lib/adminSettingsHubLoad.ts");
  assert.match(loadSrc, /hold_winback_enabled, number_hold_days, reactivation_fee_kes/);
  assert.match(loadSrc, /holdColumns: false/);
});
