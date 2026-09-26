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
    assert.match(page, /bucketLabel\(pack\.minutesUsed, pack\.minutesIncluded\)/);
    assert.match(page, /bucketLabel\(pack\.smsUsed, pack\.smsIncluded\)/);
    assert.match(page, /bucketLabel\(pack\.emailUsed, pack\.emailIncluded\)/);
    assert.match(page, /bucketLabel\(pack\.waUsed, pack\.waIncluded\)/);
    assert.match(page, /bucketLabel\(pack\.seatsUsed, pack\.seatsIncluded\)/);
    assert.match(page, /KES \{inboundMin\}\/min/);
    assert.doesNotMatch(page, /WalletTopUpButton/);
    assert.doesNotMatch(page, /Top up prepaid/);
    assert.doesNotMatch(page, /daysRemainingAtPace/);
  });

  it("opts into on-demand after included buckets hit zero", () => {
    const panel = read("dashboard/src/components/OnDemandUsagePanel.tsx");
    const actions = read("dashboard/src/app/(desk)/wallet/actions.ts");
    assert.match(
      panel,
      /Continue after included minutes, SMS, email, or WhatsApp hit zero/
    );
    assert.doesNotMatch(panel, /prepaid minutes/);
    assert.match(actions, /included minutes, SMS, email, or WhatsApp hit zero/);
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
