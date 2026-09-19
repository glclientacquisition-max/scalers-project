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
    assert.doesNotMatch(niche, /label: "Archived"/);
    assert.match(purpose, /export function itemIsArchived/);
    assert.doesNotMatch(purpose, /if \(lead\.leadStatus === "archived"\) continue/);
    assert.doesNotMatch(niche, /Unread/);
    assert.doesNotMatch(niche, /Assigned to me/);
    assert.match(toolbar, /<InboxFilterPills/);
    assert.match(toolbar, /label="Filter by purpose"/);
    assert.match(toolbar, /<FilterTabs/);
    assert.match(toolbar, /label="Visit sort"/);
    assert.match(toolbar, /archived \? null/);
    const entry = read("dashboard/src/components/InboxArchivedRow.tsx");
    assert.match(entry, /InboxArchivedPhoneRow/);
    assert.match(entry, /InboxArchivedTableRow/);
    assert.match(entry, /label="Archived"/);
    assert.match(page, /showArchivedEntry/);
    assert.match(page, /ret=\{inboxRet\}/);
    assert.match(page, /backHref=\{archivedBackHref\}/);
    assert.match(toolbar, /backHref \|\| callsHref/);
    assert.match(entry, /inboxArchivedHref\(ret\)/);
    assert.match(harness, /InboxArchivedPhoneRow/);
  });

  it("keeps phone rows through md so the Action dock is not clipped", () => {
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    assert.match(page, /lg:hidden/);
    assert.match(page, /hidden lg:block/);
    assert.match(page, /minWidthClass="min-w-0"/);
    assert.doesNotMatch(page, /min-w-\[720px\]/);
  });

  it("debounces search against the existing q param", () => {
    assert.match(toolbar, /requestSubmit/);
    assert.match(toolbar, /setTimeout\(\(\) => form\?\.requestSubmit\(\), 300\)/);
  });

  it("keeps search-empty, filter-empty, and inbox-empty distinct", () => {
    assert.match(page, /No matches/);
    assert.match(page, /Nothing needs you/);
    assert.match(page, /None archived/);
    assert.match(page, /Inbox is empty/);
    assert.doesNotMatch(page, /inboxCaption/);
    assert.match(purpose, /\$\{needs\} need you/);
    assert.match(harness, /ROWS.filter\(\(row\) => row.needsYou\)/);
  });

  it("renders the six purpose piles as snap-scrolling pill chips", () => {
    const pills = read("dashboard/src/components/InboxFilterPills.tsx");
    assert.match(pills, /snap-x snap-mandatory/);
    assert.match(pills, /snap-start/);
    assert.match(pills, /rounded-full/);
    assert.match(pills, /bg-\[#005CCC\] text-white/);
    assert.match(pills, /bg-gradient-to-l from-surface/);
    assert.match(pills, /item\.count/);
    assert.doesNotMatch(pills, /border-b-2/);
    assert.doesNotMatch(pills, /filterTabClass/);
    assert.match(toolbar, /<InboxFilterPills/);
    assert.match(toolbar, /label="Filter by purpose"/);
    assert.match(toolbar, /label="Visit sort"/);
    assert.match(toolbar, /label="Hold sort"/);
    assert.match(toolbar, /label="Work date"/);
    const purposeCall = toolbar.match(/<InboxFilterPills[\s\S]*?\/>/);
    assert.ok(purposeCall, "purpose row is InboxFilterPills");
    assert.doesNotMatch(purposeCall[0], /<FilterTabs/);
    assert.doesNotMatch(niche, /Unread|Snooze/);
  });
});
