const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox filters and empty states", () => {
  const niche = read("dashboard/src/lib/inboxNiche.ts");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const page = read("dashboard/src/app/(desk)/calls/page.tsx");
  const purpose = read("dashboard/src/lib/inboxPurpose.ts");
  const harness = read("dashboard/src/app/dev/inbox/page.tsx");

  it("uses existing purpose piles, not Unread or Assigned", () => {
    assert.match(niche, /label: "Needs you"/);
    assert.match(niche, /label: "All"/);
    assert.match(niche, /label: "Human"/);
    assert.doesNotMatch(niche, /Unread/);
    assert.doesNotMatch(niche, /Assigned to me/);
    assert.match(toolbar, /<FilterTabs/);
    assert.match(toolbar, /label="Filter by purpose"/);
  });

  it("debounces search against the existing q param", () => {
    assert.match(toolbar, /requestSubmit/);
    assert.match(toolbar, /setTimeout\(\(\) => form\?\.requestSubmit\(\), 300\)/);
  });

  it("keeps search-empty, filter-empty, and inbox-empty distinct", () => {
    assert.match(page, /No matches/);
    assert.match(page, /Nothing needs you/);
    assert.match(page, /Inbox is empty/);
    assert.match(page, /inboxCaption\(searched, vertical\)/);
    assert.match(purpose, /\$\{needs\} need you/);
    assert.match(harness, /ROWS.filter\(\(row\) => row.needsYou\)/);
  });
});
