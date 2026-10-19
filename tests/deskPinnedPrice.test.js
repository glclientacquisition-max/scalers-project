const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function walk(rel) {
  const abs = path.join(root, rel);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) return walk(child);
    return /\.(ts|tsx|js)$/.test(entry.name) ? [child] : [];
  });
}

function sliceFn(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} missing`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("Desk prices come from the pinned package version", () => {
  it("no Desk route or plan component reads billing_rate_card", () => {
    const files = [...walk("dashboard/src/app/(desk)"), ...walk("dashboard/src/components/plan")];
    assert.ok(files.length > 10);
    for (const file of files) {
      assert.doesNotMatch(read(file), /billing_rate_card/, file);
    }
  });

  it("the owner meter does not read the rate card", () => {
    const meter = sliceFn(read("dashboard/src/lib/packageCatalog.ts"), "loadOwnerPackageMeter");
    assert.doesNotMatch(meter, /billing_rate_card|mapRates|rates/);
    assert.doesNotMatch(meter, /monthly_price_kes/);
  });

  it("the Home billing view prices from the pinned version, not the live package row", () => {
    const load = read("dashboard/src/lib/billingStateLoad.ts");
    assert.match(load, /from\("billing_subscription_read"\)\.select\("version_monthly_price_kes"\)/);
    assert.doesNotMatch(load, /billing_packages/);
    assert.doesNotMatch(load, /billing_rate_card/);
  });

  it("the plan screen prices from billing_package_versions", () => {
    const plan = read("dashboard/src/lib/ownerPlanLoad.ts");
    assert.match(plan, /version_monthly_price_kes/);
    assert.match(plan, /version_minutes/);
    assert.match(plan, /billing_package_versions/);
    assert.match(plan, /eq\("status", "published"\)/);
    assert.match(plan, /versionById/);
    assert.doesNotMatch(plan, /billing_rate_card/);
    const picker = read("dashboard/src/components/plan/PlanPicker.tsx");
    assert.match(picker, /model\.pinned/);
    assert.match(picker, /publishedCurrent/);
  });

  it("no Desk screen takes a price, minutes, seats, or credits figure from billing_packages", () => {
    const figure = /monthly_price_kes|annual_price_kes|message_credits|extra_seat_monthly_kes|credit_kes|\bminutes\b|\bseats\b|\bsms\b|\bemail\b|staff_wa|inbound_kes|outbound_kes|\*/;
    const files = [
      ...walk("dashboard/src/app/(desk)"),
      ...walk("dashboard/src/components/plan"),
      "dashboard/src/lib/ownerPlanLoad.ts",
      "dashboard/src/lib/billingStateLoad.ts",
      "dashboard/src/lib/ownerUsageLoad.ts",
    ];
    const selectRe = /\.from\("billing_packages"\)\s*\.select\(\s*"([^"]+)"/g;
    let selects = 0;
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /billing_rate_card/, file);
      for (const match of source.matchAll(selectRe)) {
        selects += 1;
        assert.doesNotMatch(match[1], figure, `${file} selects ${match[1]}`);
      }
    }
    assert.ok(selects >= 2, "expected the plan loader to read package names");
    const meter = sliceFn(read("dashboard/src/lib/packageCatalog.ts"), "loadOwnerPackageMeter");
    assert.doesNotMatch(meter, /monthly_price_kes|message_credits|billing_rate_card/);
    const nameOnly = meter.match(/\.from\("billing_packages"\)\s*\.select\(\s*"([^"]+)"/);
    assert.ok(nameOnly, "owner meter reads the package name");
    assert.equal(nameOnly[1], "name");
  });
});
