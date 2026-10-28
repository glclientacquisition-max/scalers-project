const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("Overview streams in parts (D2)", () => {
  const page = read("dashboard/src/app/(desk)/home/page.tsx");
  const slots = read("dashboard/src/components/home/HomeOverviewSlots.tsx");
  const skeletons = read("dashboard/src/components/home/HomeOverviewSkeletons.tsx");
  const loading = read("dashboard/src/app/(desk)/home/loading.tsx");
  const gate = read("dashboard/src/components/DeskPageGate.tsx");

  it("keeps the slow loaders off the page's critical path", () => {
    for (const slow of [
      "loadOwnerBillingView(",
      "loadUsageBillingExtras(",
      "loadOwnerPackageMeter(",
      "loadCallInsights(",
      "loadCallSetupState(",
      "loadReadyChecklist(",
      "areaConfirmCheck(",
    ]) {
      assert.ok(!page.includes(slow), `page should not await ${slow}`);
      assert.ok(slots.includes(slow), `slot should load ${slow}`);
    }
  });

  it("folds the independent first reads into one Promise.all", () => {
    assert.match(page, /Promise\.all\(\[\s*createWorkspaceDataClient\(\),\s*memberCan\("settings\.edit"\),\s*\]\)/);
    assert.match(page, /const \[todayRes, inbox, score, hold\] = await Promise\.all\(/);
  });

  it("wraps every slot in its own Suspense with a shaped or empty fallback", () => {
    assert.match(page, /<Suspense fallback=\{<HomeUsageSkeleton \/>\}>\s*<HomeUsageSlot/);
    assert.match(page, /<Suspense fallback=\{<HomeInsightsSkeleton \/>\}>\s*<HomeInsightsSlot/);
    assert.match(page, /<Suspense fallback=\{null\}>\s*<HomeCallSetupSlot/);
    assert.match(page, /<Suspense fallback=\{null\}>\s*<HomeChecksSlot/);
  });

  it("keeps role gates: usage behind usage.view, call setup behind settings.edit, area nudge for editors", () => {
    assert.match(page, /<RoleGate action="usage\.view" mode="hide">\s*<Suspense fallback=\{<HomeUsageSkeleton \/>\}>/);
    assert.match(slots, /<RoleGate action="settings\.edit" mode="hide">\s*<HomeCallSetupCard/);
    assert.match(slots, /canEditSettings \? areaConfirmCheck\(tenant\) : Promise\.resolve\(null\)/);
  });

  it("uses an Overview-shaped route skeleton, not the generic list", () => {
    assert.match(loading, /<HomeSkeleton \/>/);
    assert.match(page, /<DeskPageGate fallback=\{<HomeSkeleton \/>\}>/);
    assert.match(gate, /fallback \?\? <DeskPageSkeleton \/>/);
    assert.match(skeletons, /lg:grid-cols-12/);
  });

  it("uses tokens only and no em or en dashes", () => {
    for (const src of [slots, skeletons]) {
      assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b|\[#[0-9a-fA-F]{3,8}\]/);
      assert.doesNotMatch(src, /[\u2014\u2013]/);
    }
  });
});
