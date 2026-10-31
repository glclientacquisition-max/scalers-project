const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("calls card", () => {
  it("compares only when the earlier window has rows", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/lib/ops/callsCard.ts"), "utf8");
    assert.match(src, /priorCalls: prior\.length > 0 \? prior\.length : null/);
    assert.match(src, /if \(!rows\) return \{ state: "error" \}/);
    assert.match(src, /state: "empty"/);
    assert.match(src, /loadInsightFacts|days \* 2|days \* 86400_000/);
    assert.match(src, /days === 7 \? dayCounts/);
    const ui = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/components/admin/v2/AdminDashboard.tsx"), "utf8");
    assert.match(ui, /unit="calls"/);
    assert.match(ui, /unit="ksh"/);
    assert.doesNotMatch(ui, /format=\{/);
    assert.match(ui, /lg:col-span-8/);
    assert.doesNotMatch(ui, /lg:grid-cols-2/);
    assert.match(ui, /lg:col-span-4/);
  });
});
