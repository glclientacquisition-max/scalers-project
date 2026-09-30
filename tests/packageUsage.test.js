const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("package usage meter", () => {
  it("ceils seconds to minutes and never goes negative", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    assert.match(catalog, /export function minutesUsedFromSeconds/);
    assert.match(catalog, /Math\.ceil\(Math\.max\(0, Number\(seconds\) \|\| 0\) \/ 60\)/);
    assert.match(catalog, /export function remainingCount/);
    assert.match(
      catalog,
      /Math\.max\(0, Math\.floor\(Number\(included\) \|\| 0\) - Math\.max\(0, Number\(used\) \|\| 0\)\)/
    );
    assert.equal(Math.ceil(90 / 60), 2);
    assert.equal(Math.max(0, 300 - 2), 298);
    assert.equal(Math.max(0, 0 - 5), 0);
  });

  it("loads owner remaining from tenant counters and the catalog via service role", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    assert.match(catalog, /export async function loadOwnerPackageMeter/);
    assert.match(catalog, /minutes_included, seconds_used/);
    assert.match(catalog, /tenant_subscriptions/);
    assert.match(catalog, /billing_packages/);
    assert.match(catalog, /tenant_members/);
    assert.match(catalog, /export async function loadBusinessPackageNames/);
  });

  it("shows minutes left and used/included buckets on Usage", () => {
    const page = read("dashboard/src/app/(desk)/wallet/page.tsx");
    assert.match(page, /loadOwnerPackageMeter\(tenant\.id\)/);
    assert.match(page, /Minutes left/);
    assert.match(page, /label: "Minutes", left: minutesLeft, used: pack\.minutesUsed/);
    assert.match(page, /label: "SMS", left: smsLeft, used: pack\.smsUsed/);
    assert.match(page, /label: "Email", left: emailLeft, used: pack\.emailUsed/);
    assert.match(page, /label: "WhatsApp", left: waLeft, used: pack\.waUsed/);
    assert.match(page, /label: "Seats"/);
    assert.match(page, /On-demand rates/);
    assert.match(page, /KES \{kes\(inboundMin\)\}\/min/);
    assert.doesNotMatch(page, /WalletTopUpButton/);
    assert.doesNotMatch(page, /Top up prepaid/);
    assert.doesNotMatch(page, /daysRemainingAtPace/);
  });

  it("lists package prices on the landing page from the catalog", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
    const prices = read("dashboard/src/components/marketing/PackagePrices.tsx");
    const home = read("dashboard/src/app/page.tsx");
    assert.match(catalog, /export async function loadPublicPackageOffers/);
    assert.match(catalog, /annualPriceKes\(monthlyPriceKes, rates\.annualDiscountPercent\)/);
    assert.match(home, /loadPublicPackageOffers/);
    assert.match(landing, /id="packages"/);
    assert.match(prices, /Not set/);
    assert.match(prices, /past included/);
    assert.doesNotMatch(prices, /Most popular/);
  });

  it("opts into on-demand after included buckets hit zero", () => {
    const panel = read("dashboard/src/components/OnDemandUsagePanel.tsx");
    const actions = read("dashboard/src/app/(desk)/wallet/actions.ts");
    assert.match(panel, /Charge the wallet for minutes and SMS past included/);
    assert.doesNotMatch(panel, /prepaid minutes/);
    assert.doesNotMatch(panel, /Continue after included/);
    assert.match(actions, /Past included minutes and SMS, charge the wallet/);
  });

  it("says calls stop when included minutes are gone and on-demand is off", () => {
    const page = read("dashboard/src/app/(desk)/wallet/page.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    const copy = read("dashboard/src/lib/usageCap.ts");
    assert.match(page, /usageCapNotice/);
    assert.match(copy, /Calls stopped\. Tenant SMS stopped\./);
    assert.match(copy, /Included minutes used\. Calls stopped\./);
    assert.match(copy, /Included SMS used\. Tenant SMS stopped\./);
    assert.match(home, /homeMinuteStatus/);
    assert.match(copy, /if \(!input\.onDemand\) return "Stopped"/);
  });

  it("lists the assigned package on Admin Businesses", () => {
    const admin = read("dashboard/src/lib/admin.ts");
    const panel = read("dashboard/src/components/AdminBusinessesPanel.tsx");
    assert.match(admin, /loadBusinessPackageNames/);
    assert.match(admin, /package_name: pack\?\.packageName \|\| null/);
    assert.match(panel, />Package</);
    assert.match(panel, /b\.package_name/);
  });
});
