const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("package overage math", () => {
  it("keeps inbound at KES 0.10/sec (KES 6/min) and outbound at KES 0.15/sec", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    const sql = read("docs/supabase/package_catalog.sql");
    const update = read("docs/supabase/package_rate_card_ondemand_6_9.sql");
    assert.match(catalog, /inboundKesPerSecond: 0\.1/);
    assert.match(catalog, /outboundKesPerSecond: 0\.15/);
    assert.match(sql, /inbound_kes_per_second numeric not null default 0\.10/);
    assert.match(sql, /outbound_kes_per_second numeric not null default 0\.15/);
    assert.match(update, /inbound_kes_per_second = 0\.10/);
    assert.match(update, /outbound_kes_per_second = 0\.15/);
    assert.equal(0.1 * 60, 6);
    assert.equal(0.15 * 60, 9);
  });

  it("puts Packages on Super Admin nav behind the existing username and access code", () => {
    const nav = read("dashboard/src/lib/adminLinks.ts");
    const login = read("dashboard/src/app/admin/login/page.tsx");
    const api = read("dashboard/src/app/api/admin/packages/route.ts");
    assert.match(read("dashboard/src/components/AdminNav.tsx"), /ADMIN_LINKS/);
    assert.match(nav, /href: "\/admin\/packages", label: "Packages"/);
    assert.match(login, /name="username"/);
    assert.match(login, /name="accessCode"/);
    assert.match(api, /isLegacyAuthenticated/);
    assert.doesNotMatch(nav, /BILLING_ADMIN_CODE/);
    assert.doesNotMatch(api, /BILLING_ADMIN_CODE/);
  });

  it("lets Super Admin type inbound KES/min and annual discount %; assigning lives on Billing", () => {
    const panel = read("dashboard/src/components/AdminPackagesPanel.tsx");
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    assert.match(panel, /Inbound KES \/ min/);
    assert.match(panel, /Outbound KES \/ min/);
    assert.match(panel, /Annual discount %/);
    assert.match(panel, /kesPerSecondFromMinute/);
    assert.doesNotMatch(panel, /action: "assign"/);
    assert.match(catalog, /annualDiscountPercent: 17/);
    assert.match(panel, /Hidden until live transfer/);
    assert.equal(6 / 60, 0.1);
    assert.equal(9 / 60, 0.15);
    const prices = read("docs/supabase/package_prices_5_12_25.sql");
    const sql = read("docs/supabase/package_catalog.sql");
    assert.match(catalog, /monthlyPriceKes: 5000/);
    assert.match(catalog, /monthlyPriceKes: 12000/);
    assert.match(catalog, /monthlyPriceKes: 25000/);
    assert.match(prices, /when 'starter' then 5000/);
    assert.match(prices, /when 'growth' then 12000/);
    assert.match(prices, /when 'scale' then 25000/);
    assert.match(prices, /dids = 1/);
    assert.match(sql, /'starter', 'Starter', 5000/);
    assert.match(sql, /'scale', 'Scale', 25000/);
  });
});
