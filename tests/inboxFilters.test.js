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
  const nav = read("dashboard/src/components/InboxPileNav.tsx");
  const page = read("dashboard/src/app/(desk)/calls/page.tsx");
  const board = read("dashboard/src/components/InboxPileBoard.tsx");
  const purpose = read("dashboard/src/lib/inboxPurpose.ts");
  const harness = read("dashboard/src/app/dev/inbox/page.tsx");
  const inbox = page + board;

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
    assert.match(inbox, /showArchivedEntry/);
    assert.match(board, /ret=\{ret\}/);
    assert.match(page, /backHref=\{archivedBackHref\}/);
    assert.match(toolbar, /backHref \|\| callsHref/);
    assert.match(entry, /inboxArchivedHref\(ret\)/);
    assert.match(harness, /InboxArchivedPhoneRow/);
  });

  it("keeps phone rows through md so the Action dock is not clipped", () => {
    const inbox = read("dashboard/src/app/(desk)/calls/page.tsx") +
      read("dashboard/src/components/InboxPileBoard.tsx");
    assert.match(inbox, /lg:hidden/);
    assert.match(inbox, /hidden lg:block/);
    assert.match(inbox, /minWidthClass="min-w-0"/);
    assert.doesNotMatch(inbox, /min-w-\[720px\]/);
  });

  it("filters the in-memory tape as you type without a Search submit", () => {
    assert.match(toolbar, /type="search"/);
    assert.match(toolbar, /value=\{query\}/);
    assert.doesNotMatch(toolbar, /defaultValue=\{q\}/);
    assert.doesNotMatch(toolbar, /requestSubmit/);
    assert.doesNotMatch(toolbar, /type="submit"/);
    assert.doesNotMatch(toolbar, />Search</);
    assert.match(nav, /itemMatchesQuery/);
    assert.match(nav, /countInboxPurposes/);
    assert.match(nav, /setTimeout\([\s\S]*?300/);
    assert.match(nav, /router\.replace/);
    assert.doesNotMatch(nav, /requestSubmit/);
    assert.match(page, /items=\{assembled\}/);
    assert.doesNotMatch(page, /<InboxPileNavProvider[\s\S]*?items=\{searched\}/);
  });

  it("keeps search-empty, filter-empty, and inbox-empty distinct", () => {
    assert.match(inbox, /No matches/);
    assert.doesNotMatch(toolbar, /Matches for/);
    assert.doesNotMatch(inbox, /Clear search/);
    assert.doesNotMatch(inbox, /Matches for/);
    assert.match(board, />\s*Clear\s*</);
    assert.match(inbox, /Nothing needs you/);
    assert.match(inbox, /None archived/);
    assert.match(inbox, /Inbox is empty/);
    assert.doesNotMatch(inbox, /inboxCaption/);
    assert.match(purpose, /\$\{needs\} need you/);
    assert.match(harness, /ROWS.filter\(\(row\) => row.needsYou\)/);
    assert.match(toolbar, /name="purpose"/);
    assert.match(toolbar, /inboxPileHref\(item\.id/);
  });

  it("renders the six purpose piles as snap-scrolling pill chips", () => {
    const pills = read("dashboard/src/components/InboxFilterPills.tsx");
    const chrome = read("dashboard/src/components/ui/deskChrome.ts");
    assert.match(pills, /deskRateCardRowClass/);
    assert.match(pills, /snap-start/);
    assert.match(pills, /deskRateCardClass/);
    assert.match(chrome, /rounded-full/);
    assert.match(chrome, /bg-\[#005CCC\] text-white/);
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
