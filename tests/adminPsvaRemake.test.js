const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Packages catalog: header unlock session then package-versions draft/publish; no business assign", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminPackagesV2.tsx");
  assert.match(ui, /useAdminUnlockSession/);
  assert.doesNotMatch(ui, /UnlockCta/);
  assert.match(ui, /\/api\/admin\/package-versions/);
  assert.match(ui, /action: "draft"/);
  assert.match(ui, /action: "update_draft"/);
  assert.doesNotMatch(ui, /move_subscribers|set_billing_mode/);
  assert.doesNotMatch(ui, /Secure sign-in is next/);
  assert.match(ui, /data-stepup="packages"/);
  assert.match(ui, /data-catalog-edit/);
});

test("Services: unlock session reveals AdminPlatformOpsForm (postOps path)", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminServicesV2.tsx");
  assert.match(ui, /useAdminUnlockSession/);
  assert.match(ui, /AdminPlatformOpsForm/);
  assert.match(ui, /data-unlocked-edit="services"/);
  assert.doesNotMatch(ui, /Secure sign-in is next/);
});

test("Voices: unlock session reveals AdminVoicesManager save path", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminVoicesV2.tsx");
  assert.match(ui, /useAdminUnlockSession/);
  assert.match(ui, /AdminVoicesManager/);
  assert.match(ui, /data-unlocked-edit="voices"/);
  assert.doesNotMatch(ui, /Secure sign-in is next/);
});

test("Audit: keyboardable desktop rows + j/k density like Businesses", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminAuditV2.tsx");
  assert.match(ui, /tabIndex=\{0\}/);
  assert.match(ui, /onKeyDown/);
  assert.match(ui, /e\.key === "j"/);
  assert.match(ui, /data-audit-table/);
  assert.match(ui, /pe-ops-4/);
});
