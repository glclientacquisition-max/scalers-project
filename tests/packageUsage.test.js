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
    assert.match(page, />Calls</);
    assert.match(page, /KES \{kes\(inboundMin\)\}\/min/);
    assert.doesNotMatch(page, /Calls out/);
    assert.doesNotMatch(page, /WalletTopUpButton/);
    assert.doesNotMatch(page, /Top up prepaid/);
    assert.doesNotMatch(page, /daysRemainingAtPace/);
  });

  it("does not list package prices on the landing page", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
    const prices = read("dashboard/src/components/marketing/PackagePrices.tsx");
    const home = read("dashboard/src/app/page.tsx");
    const loader = catalog.slice(catalog.indexOf("export async function loadPublicPackageOffers"));
    assert.match(catalog, /export async function loadPublicPackageOffers/);
    assert.match(catalog, /annualPriceKes\(monthlyPriceKes, discount\)/);
    assert.match(loader, /emptyPublicBoard/);
    assert.doesNotMatch(loader, /strawPublicBoard/);
    assert.doesNotMatch(home, /loadPublicPackageOffers/);
    assert.doesNotMatch(home, /strawPublicBoard/);
    assert.doesNotMatch(landing, /PackagePrices/);
    assert.doesNotMatch(landing, /id="packages"/);
    assert.doesNotMatch(landing, /href="#packages"/);
    assert.doesNotMatch(landing, /Packages/);
    assert.doesNotMatch(landing, /emptyPublicBoard/);
    assert.doesNotMatch(landing, /strawPublicBoard/);
    assert.doesNotMatch(landing, /5000|12000|25000/);
    assert.match(prices, /packagePriceLabel/);
    assert.match(prices, /Prices are not on this page yet/);
    assert.match(prices, /inboundKesPerMinute > 0/);
    assert.match(prices, /past included/);
    assert.match(prices, /calls KES \{formatKes\(board\.inboundKesPerMinute\)\}\/min\./);
    assert.doesNotMatch(prices, /<table/);
    assert.doesNotMatch(prices, /border-accent/);
    assert.doesNotMatch(prices, /5000|12000|25000/);
    assert.doesNotMatch(prices, /min out/);
    assert.match(prices, /Per month/);
    assert.match(prices, /Per year/);
    assert.doesNotMatch(prices, /Most popular/);
    const label = read("dashboard/src/lib/packagePriceLabel.ts");
    assert.match(label, /if \(!\(amount > 0\)\) return "Not set"/);
  });

  it("labels a zero package price as Not set and keeps the assigned period", async () => {
    const { packagePriceLabel, assignmentFromBusiness } = await import(
      "../dashboard/src/lib/packagePriceLabel.ts"
    );
    assert.equal(packagePriceLabel(0), "Not set");
    assert.equal(packagePriceLabel(-4), "Not set");
    assert.match(packagePriceLabel(1500), /^KES /);
    assert.deepEqual(assignmentFromBusiness({ packageId: "pkg-growth", period: "year" }), {
      packageId: "pkg-growth",
      period: "year",
    });
    assert.deepEqual(assignmentFromBusiness({ packageId: "", period: "week" }), {
      packageId: null,
      period: null,
    });
    assert.deepEqual(assignmentFromBusiness(null), { packageId: null, period: null });
  });

  it("previews landing prices and follows the selected business on Admin", () => {
    const panel = read("dashboard/src/components/AdminPackagesPanel.tsx");
    const page = read("dashboard/src/app/admin/(console)/packages/page.tsx");
    assert.match(panel, /packagePriceLabel/);
    assert.match(panel, /Per year/);
    assert.match(panel, /live on landing/);
    assert.match(panel, /Now \$\{selected\.packageName/);
    assert.match(panel, /Now none/);
    assert.match(panel, /assignmentFromBusiness/);
    assert.match(panel, /action: "save_package"/);
    assert.match(panel, /action: "assign"/);
    assert.match(panel, /usedOfIncluded\(minutesUsedFromSeconds/);
    assert.match(panel, /row\.gap/);
    assert.match(panel, /Matches package/);
    assert.match(panel, /ListRow/);
    assert.match(panel, /Needs you/);
    assert.doesNotMatch(panel, /Most popular/);
    assert.doesNotMatch(panel, /<table/);
    assert.doesNotMatch(page, /deskListTitleClass/);
  });

  it("names when included amounts do not match the assigned package", async () => {
    const { packageUsageGap, shouldApplyLineRental, usedOfIncluded } = await import(
      "../dashboard/src/lib/packageUsageAlign.ts"
    );
    const starter = { minutes: 300, sms: 200, email: 100, staffWa: 200, seats: 2 };
    const matched = {
      minutesIncluded: 300,
      secondsUsed: 0,
      smsIncluded: 200,
      smsUsed: 0,
      emailIncluded: 100,
      emailUsed: 0,
      waIncluded: 200,
      waUsed: 0,
      seatsIncluded: 2,
      seatsUsed: 1,
    };
    assert.equal(packageUsageGap({ packageName: "Starter", catalog: starter, usage: matched }), null);
    assert.equal(
      packageUsageGap({
        packageName: null,
        catalog: null,
        usage: { ...matched, minutesIncluded: 0, secondsUsed: 107, smsUsed: 47, seatsIncluded: 5 },
      }),
      "No package"
    );
    assert.equal(
      packageUsageGap({
        packageName: "Starter",
        catalog: starter,
        usage: { ...matched, minutesIncluded: 0, seatsIncluded: 5 },
      }),
      "Minutes included 0, Starter is 300. Seats included 5, Starter is 2"
    );
    assert.equal(
      packageUsageGap({ packageName: "Starter", catalog: null, usage: matched }),
      "Package is not in the catalog"
    );
    assert.equal(usedOfIncluded(47, 200), "47 of 200");
    assert.equal(shouldApplyLineRental("off", false), false);
    assert.equal(shouldApplyLineRental("soft", true), false);
    assert.equal(shouldApplyLineRental("hard", false), true);

    const billingDetail = read("dashboard/src/components/AdminBillingDetailPanel.tsx");
    const wallet = read("dashboard/src/lib/wallet.ts");
    assert.match(billingDetail, /Beta: meter the package\. On-demand ledger is not charged\./);
    assert.match(billingDetail, /On-demand past included/);
    assert.doesNotMatch(billingDetail, /line fees/);
    assert.doesNotMatch(billingDetail, /CREDIT_PRESETS/);
    assert.match(wallet, /shouldApplyLineRental/);
    assert.match(wallet, /tenantHasAssignedPackage/);
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
    assert.match(panel, /b\.package_name/);
    assert.match(panel, /packLabel/);
  });
});
