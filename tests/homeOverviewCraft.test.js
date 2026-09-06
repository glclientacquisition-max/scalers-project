const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("home overview craft", () => {
  const page = read("dashboard/src/app/(desk)/home/page.tsx");
  const triage = read("dashboard/src/lib/callsTriage.ts");

  it("uses greeting eyebrow, business name, and Nairobi date", () => {
    assert.match(page, /nairobiGreeting\(\)/);
    assert.match(page, /nairobiDateLabel\(\)/);
    assert.match(page, /<time dateTime=\{today\.iso\}>/);
    assert.match(triage, /export function nairobiDateLabel/);
    assert.doesNotMatch(page, />Overview</);
  });

  it("keeps the command-center table and one aside", () => {
    assert.match(page, /DeskDataTable/);
    assert.match(page, /aria-label="What happened"/);
    assert.match(page, /lineStatusLabel\(line\)/);
    assert.match(page, /hover:border-l-\[#0096FF\]/);
    assert.doesNotMatch(page, /TriageLeadCard/);
    assert.doesNotMatch(page, /\bOnline\b/);
  });
});
