const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("GIGO owner attest wiring", () => {
  it("settings save calls ownerAttestFields with scoped paths", () => {
    const actions = read("dashboard/src/app/(desk)/settings/actions.ts");
    assert.match(actions, /fieldPathsAttestedOnSettingsSave/);
    assert.match(actions, /ownerAttestFields/);
    assert.match(actions, /cleanFieldPaths/);
  });

  it("alerts and bulletin saves attest notify and bulletin paths", () => {
    const alerts = read("dashboard/src/app/(desk)/settings/alertsActions.ts");
    const bulletin = read("dashboard/src/app/(desk)/settings/bulletinActions.ts");
    assert.match(alerts, /fieldPathsAttestedOnAlertsSave/);
    assert.match(alerts, /ownerAttestFields/);
    assert.match(bulletin, /fieldPathsAttestedOnBulletinSave/);
    assert.match(bulletin, /ownerAttestFields/);
  });

  it("field path registry covers identity, hours, and notify", () => {
    const registry = read("dashboard/src/lib/fieldPathRegistry.ts");
    assert.ok(registry.includes("business_name|vertical"));
    assert.ok(registry.includes("weekly_grid"));
    assert.ok(registry.includes("whatsapp|email|channels"));
  });

  it("settings save scope helper is exported for attest builder", () => {
    const scope = read("dashboard/src/lib/settingsSaveScope.ts");
    assert.match(scope, /export function settingsScopeIncludes/);
    const builder = read("dashboard/src/lib/fieldPathsFromSettingsSave.ts");
    assert.match(builder, /settingsScopeIncludes/);
    assert.match(builder, /fieldPathsAttestedOnAlertsSave/);
  });

  it("settings save is owner approval without separate confirm UI", () => {
    const form = read("dashboard/src/components/TenantForm.tsx");
    const alerts = read("dashboard/src/components/AlertsPanel.tsx");
    assert.doesNotMatch(form, /CaptureConfirmList/);
    assert.doesNotMatch(alerts, /CaptureConfirmList/);
    assert.match(form, /owner_field_paths/);
  });

  it("settings save builder attests catalogue name paths", () => {
    const builder = read("dashboard/src/lib/fieldPathsFromSettingsSave.ts");
    assert.match(builder, /catalog\.product\.\$\{sku\}\.name/);
    assert.match(builder, /catalog\.service\.\$\{index \+ 1\}\.name/);
    assert.match(builder, /includes\("servicesCatalog"\)/);
    assert.match(builder, /includes\("productCatalog"\)/);
  });
});
