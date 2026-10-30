const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("package usage meter", () => {
  it("floors seconds to whole minutes and never goes negative", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    const minutes = read("dashboard/src/lib/minutes.ts");
    assert.match(catalog, /export \{ minutesUsedFromSeconds \}/);
    assert.match(minutes, /export function minutesUsedFromSeconds/);
    assert.match(minutes, /Math\.floor\(Math\.max\(0, finite\(seconds\)\) \/ 60\)/);
    assert.match(catalog, /export function remainingCount/);
    assert.match(
      catalog,
      /Math\.max\(0, Math\.floor\(Number\(included\) \|\| 0\) - Math\.max\(0, Number\(used\) \|\| 0\)\)/
    );
    assert.equal(Math.floor(90 / 60), 1);
    assert.equal(Math.max(0, 300 - 1), 299);
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

  it("shows minutes left and message credits on Usage", () => {
    const page = read("dashboard/src/app/(desk)/wallet/page.tsx");
    const summary = read("dashboard/src/components/plan/UsageSummary.tsx");
    assert.match(page, /loadOwnerUsageView\(tenant\)/);
    assert.match(read("dashboard/src/lib/ownerUsageLoad.ts"), /loadOwnerPackageMeter\(tenant\.id\)/);
    assert.match(summary, /Minutes left/);
    assert.match(page, /label: "Message credits"/);
    assert.match(page, /planEntry\(extras\.billingStatus, canChangePlan\)/);
    assert.doesNotMatch(page, /a credit/);
    assert.doesNotMatch(page, /\bSMS\b/);
    assert.doesNotMatch(page, /On-demand rates/);
    assert.doesNotMatch(page, /WalletTopUpButton/);
    assert.doesNotMatch(page, /Top up prepaid/);
    assert.doesNotMatch(page, /daysRemainingAtPace/);
  });

  it("stacks each Usage column on its own at lg so the minutes card is not stretched", () => {
    const summary = read("dashboard/src/components/plan/UsageSummary.tsx");
    assert.match(summary, /lg:grid lg:grid-cols-12 lg:items-start/);
    assert.match(summary, /contents lg:col-span-7 lg:flex lg:min-w-0 lg:flex-col lg:gap-6/);
    assert.doesNotMatch(summary, /lg:row-span-2/);
  });

  it("does not list package prices on the landing page", () => {
    const catalog = read("dashboard/src/lib/packageCatalog.ts");
    const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
    const prices = read("dashboard/src/components/marketing/PackagePrices.tsx");
    const home = read("dashboard/src/app/page.tsx");
    const loader = catalog.slice(catalog.indexOf("export async function loadPublicPackageOffers"));
    assert.match(catalog, /export async function loadPublicPackageOffers/);
    assert.match(catalog, /publishedPublicOffers/);
    assert.match(loader, /annual_price_kes/);
    assert.doesNotMatch(loader, /annualPriceKes\(monthlyPriceKes, discount\)/);
    assert.match(loader, /emptyPublicBoard/);
    assert.doesNotMatch(loader, /strawPublicBoard/);
    assert.doesNotMatch(home, /loadPublicPackageOffers/);
    assert.doesNotMatch(home, /strawPublicBoard/);
    assert.doesNotMatch(landing, /PackagePrices/);
    assert.doesNotMatch(landing, /id="packages"/);
    assert.doesNotMatch(landing, /href="#packages"/);
    assert.doesNotMatch(landing, /emptyPublicBoard/);
    assert.doesNotMatch(landing, /strawPublicBoard/);
    assert.doesNotMatch(landing, /5000|12000|25000/);
    assert.match(read("dashboard/src/components/marketing/pricingMath.ts"), /packagePriceLabel/);
    assert.match(prices, /Package prices are not on this page yet/);
    assert.match(prices, /inboundKesPerMinute > 0/);
    assert.match(prices, /Recommended/);
    assert.doesNotMatch(prices, /<table/);
    assert.doesNotMatch(prices, /border-accent/);
    assert.doesNotMatch(prices, /5000|12000|25000/);
    assert.doesNotMatch(prices, /min out/);
    assert.doesNotMatch(prices, /Most popular|Beta program/);
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

  it("previews landing prices and sends package changes to the business's Billing page", () => {
    const panel = read("dashboard/src/components/AdminPackagesPanel.tsx");
    const page = read("dashboard/src/app/admin/(console)/_screens/PackagesScreen.tsx");
    assert.match(panel, /adminMoney/);
    assert.match(panel, /Per year/);
    assert.match(panel, /live on landing/);
    assert.match(panel, /action: "save_package"/);
    assert.doesNotMatch(panel, /action: "assign"/);
    assert.match(panel, /\/admin\/businesses\/\$\{tenantId\}\?money=1/);
    assert.match(panel, /row\.gap/);
    assert.match(panel, /ListRow/);
    assert.match(panel, /Needs you/);
    assert.doesNotMatch(panel, /Most popular/);
    assert.doesNotMatch(panel, /<table/);
    assert.doesNotMatch(page, /deskListTitleClass/);
  });

  it("names when included amounts do not match the assigned package", async () => {
    const { packageUsageGap, usedOfIncluded } = await import(
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

    const money = read("dashboard/src/components/AdminShopMoneyPanel.tsx");
    const wallet = read("dashboard/src/lib/wallet.ts");
    assert.match(money, /Meter the package\. No charges\./);
    assert.match(money, /Past included is charged/);
    assert.doesNotMatch(money, /line fees/);
    assert.doesNotMatch(money, /CREDIT_PRESETS/);
    assert.doesNotMatch(wallet, /ensureLineRentalApplied|apply_line_rental/);
  });

  it("opts into on-demand after included buckets hit zero", () => {
    const panel = read("dashboard/src/components/OnDemandUsagePanel.tsx");
    const actions = read("dashboard/src/app/(desk)/wallet/actions.ts");
    assert.match(panel, /Allow extra usage/);
    assert.doesNotMatch(panel, /a credit/);
    assert.doesNotMatch(panel, /prepaid minutes/);
    assert.doesNotMatch(panel, /Continue after included/);
    assert.doesNotMatch(panel, /the wallet/);
    assert.match(actions, /Past included minutes and SMS are charged at the on-demand rates/);
  });

  it("keeps stop-and-rate lines off the owner Usage page", () => {
    const page = read("dashboard/src/app/(desk)/wallet/page.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx") +
    // D2: usage, insights, call setup and checks stream from their own slots.
    "\n" + read("dashboard/src/components/home/HomeOverviewSlots.tsx");
    const copy = read("dashboard/src/lib/usageCap.ts");
    assert.doesNotMatch(page, /usageCapNotice/);
    assert.doesNotMatch(page, /Inbox only/);
    assert.doesNotMatch(page, /a credit/);
    assert.match(page, /planEntry\(extras\.billingStatus, canChangePlan\)/);
    assert.match(home, /homeMinuteStatus/);
    assert.match(copy, /if \(!input\.onDemand\) return "Calls stopped"/);
  });

  it("lists the assigned package on Admin Businesses", () => {
    const admin = read("dashboard/src/lib/admin.ts");
    const ui = read("dashboard/src/lib/adminBusinessUi.ts");
    assert.match(admin, /loadBusinessPackageNames/);
    assert.match(admin, /package_name: pack\?\.packageName \|\| null/);
    assert.match(ui, /export function packLabel/);
    assert.match(ui, /b\.package_name/);
    const businesses = read("dashboard/src/components/AdminBusinessesPanel.tsx");
    assert.match(businesses, /previewLine\(b\)/);
    assert.match(ui, /const pack = packLabel\(b\)/);
  });
});
