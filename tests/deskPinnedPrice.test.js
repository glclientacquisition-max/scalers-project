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
    assert.match(plan, /billing_package_versions/);
    assert.doesNotMatch(plan, /billing_rate_card/);
  });
});
