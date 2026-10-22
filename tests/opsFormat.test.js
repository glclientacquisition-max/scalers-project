const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("ops money format", async () => {
  const f = await import("../dashboard/src/lib/ops/format.ts");
  it("zero is KSh 0, never blank", () => {
    assert.equal(f.formatKsh(0), "KSh 0");
    assert.equal(f.formatKsh(null), "KSh 0");
    assert.equal(f.formatKsh(Number.NaN), "KSh 0");
  });
  it("groups thousands en-KE", () => {
    assert.equal(f.formatKsh(1000000), "KSh 1,000,000");
    assert.equal(f.formatKsh(1250), "KSh 1,250");
  });
  it("negatives use a true minus before the currency", () => {
    assert.equal(f.formatKsh(-1200), "\u2212KSh 1,200");
  });
  it("rounds to integer shillings", () => assert.equal(f.formatKsh(99.6), "KSh 100"));
  it("compact keeps small values exact", () => {
    assert.equal(f.formatKshCompact(9999), "KSh 9,999");
    assert.equal(f.formatKshCompact(1000000), "KSh 1M");
    assert.equal(f.formatKshCompact(-184500), "\u2212KSh 184.5K");
  });
  it("delta", () => {
    assert.equal(f.formatDelta(4.23), "+4.2%");
    assert.equal(f.formatDelta(-12), "\u221212.0%");
    assert.equal(f.formatDelta(0), "0.0%");
  });
  it("kit is staging only", () => {
    assert.equal(f.opsKitEnabled("staging"), true);
    for (const v of [undefined, "", "production", "prod", "staging-x"]) assert.equal(f.opsKitEnabled(v), false);
  });
});
