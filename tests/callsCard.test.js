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
  });
});
