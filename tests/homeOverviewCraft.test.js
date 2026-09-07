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

  it("maps Inbox queues and does not invent Online", () => {
    assert.match(page, /purpose: "human"/);
    assert.match(page, /purpose: "hold"/);
    assert.match(page, /purpose: "job"/);
    assert.match(page, /lineStatusLabel\(line\)/);
    assert.match(page, />\s*Work\s*</);
    assert.match(page, /homeBriefing/);
    assert.doesNotMatch(page, /DeskDataTable/);
    assert.doesNotMatch(page, /TriageLeadCard/);
    assert.doesNotMatch(page, /\bOnline\b/);
  });
});
