const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () => import(path.join(root, "dashboard/src/lib/ops/settingsHubView.ts"));

test("hold length comes from the stored row; switch and fee say no setting", async () => {
  const { holdSettings } = await load();
  const h = Object.fromEntries(holdSettings({ voicemail_hold_days: 7 }).map((v) => [v.label, v]));
  assert.equal(h["Hold length"].value, "7 days");
  assert.equal(h["Hold length"].state, "set");
  assert.equal(h["Hold switch"].state, "missing");
  assert.equal(h["Reactivation fee"].value, "Not set");
  assert.equal(h["Number reuse hold"].state, "placeholder");
});

test("missing row reads Not set, never a made-up value", async () => {
  const { holdSettings, billingSwitches } = await load();
  assert.equal(holdSettings(null).find((v) => v.label === "Hold length").value, "Not set");
  assert.ok(billingSwitches(null).every((v) => v.value === "Not set" && v.state === "missing"));
});

test("hub page is ADMIN_V2 only and read-only", () => {
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/admin/(console)/settings/general/page.tsx"), "utf8");
  const ui = fs.readFileSync(path.join(root, "dashboard/src/components/admin/v2/AdminSettingsHubV2.tsx"), "utf8");
  assert.match(page, /ADMIN_V2 !== "on"\) notFound\(\)/);
  assert.doesNotMatch(ui, /<form|onSubmit|action=|bachs/i);
});
