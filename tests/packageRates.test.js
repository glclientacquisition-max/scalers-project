const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("package overage math", () => {
  it("keeps inbound at KES 0.05/sec (KES 3/min) and outbound at KES 0.10/sec", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    const sql = read("docs/supabase/package_catalog.sql");
    assert.match(catalog, /inboundKesPerSecond: 0\.05/);
    assert.match(catalog, /outboundKesPerSecond: 0\.1/);
    assert.match(sql, /inbound_kes_per_second numeric not null default 0\.05/);
    assert.match(sql, /outbound_kes_per_second numeric not null default 0\.10/);
    assert.equal(0.05 * 60, 3);
    assert.equal(0.1 * 60, 6);
  });

  it("puts Packages on Super Admin nav behind the existing username and access code", () => {
    const nav = read("dashboard/src/components/AdminNav.tsx");
    const login = read("dashboard/src/app/admin/login/page.tsx");
    const api = read("dashboard/src/app/api/admin/packages/route.ts");
    assert.match(nav, /href: "\/admin\/packages", label: "Packages"/);
    assert.match(login, /name="username"/);
    assert.match(login, /name="accessCode"/);
    assert.match(api, /isLegacyAuthenticated/);
    assert.doesNotMatch(nav, /BILLING_ADMIN_CODE/);
    assert.doesNotMatch(api, /BILLING_ADMIN_CODE/);
  });

  it("lets Super Admin type inbound KES/min, annual discount %, and assign", () => {
    const panel = read("dashboard/src/components/AdminPackagesPanel.tsx");
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    assert.match(panel, /Inbound KES \/ min/);
    assert.match(panel, /Outbound KES \/ min/);
    assert.match(panel, /Annual discount %/);
    assert.match(panel, /kesPerSecondFromMinute/);
    assert.match(panel, /action: "assign"/);
    assert.match(catalog, /annualDiscountPercent: 17/);
    assert.equal(3 / 60, 0.05);
  });
});
