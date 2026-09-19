const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk phone shell", () => {
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const layout = read("dashboard/src/app/(desk)/layout.tsx");
  const root = read("dashboard/src/app/layout.tsx");
  const css = read("dashboard/src/app/globals.css");
  const player = read("dashboard/src/components/CallAudioPlayer.tsx");
  const constitution = read("docs/frontend/FRONTEND_CONSTITUTION.md");

  it("keeps one DESK_LINKS list for phone tabs and desktop links", () => {
    assert.match(nav, /export const DESK_LINKS/);
    assert.match(nav, /export function DeskTabBar/);
    assert.match(nav, /label: "Overview"/);
    assert.match(nav, /label: "Inbox"/);
    assert.match(nav, /label: "Contacts"/);
    assert.match(nav, /label: "Business"/);
    assert.doesNotMatch(nav, /label: "Business Profile"/);
    assert.match(nav, /label: "Wallet"/);
    assert.doesNotMatch(nav, /Menu/);
    assert.doesNotMatch(nav, /hamburger/i);
    assert.match(layout, /DeskTabBar/);
    assert.match(layout, /--desk-tabbar-clearance/);
    assert.match(css, /--desk-tabbar-clearance/);
    assert.match(css, /scroll-padding-bottom:\s*var\(--desk-tabbar-clearance\)/);
    assert.match(css, /--desk-tabbar-clearance:\s*calc\(var\(--desk-tabbar-h\) \+ env\(safe-area-inset-bottom, 0px\) \+ 1\.5rem\)/);
    assert.match(nav, /min-h-\[calc\(var\(--desk-tabbar-h\)\+env\(safe-area-inset-bottom,0px\)\)\]/);
    assert.match(nav, /bg-surface/);
    assert.doesNotMatch(nav, /bg-surface\/95/);
    assert.doesNotMatch(nav, /backdrop-blur/);
    assert.match(layout, /overflow-x-clip/);
    assert.doesNotMatch(layout, /context=\{businessName\}/);
    const inboxRow = read("dashboard/src/components/InboxItemRow.tsx");
    assert.match(inboxRow, /export function InboxPhoneRow/);
    assert.match(inboxRow, /InboxRowHit/);
    assert.match(inboxRow, /label="Conversation"/);
    assert.match(inboxRow, /InboxJobActions id=\{item.job.id\} status=\{item.job.status\} extra=\{false\}/);
    assert.match(read("dashboard/src/components/InboxTicketView.tsx"), /InboxJobActions id=\{job.id\} status=\{job.status\} banner/);
    assert.match(read("dashboard/src/components/InboxTicketView.tsx"), /RequestStatusToggle id=\{hold.id\} status=\{hold.status\} banner/);
    const jobActions = read("dashboard/src/components/InboxJobActions.tsx");
    assert.match(jobActions, /Could not save/);
    assert.ok(
      jobActions.indexOf('value="confirmed"') < jobActions.indexOf('value="cancelled"'),
      "call Confirm sits above Cancel"
    );
    assert.match(read("dashboard/src/components/RequestStatusToggle.tsx"), /btnDock/);
    assert.match(root, /viewportFit:\s*"cover"/);
    assert.match(css, /--desk-tabbar-h:\s*4rem/);
    assert.match(player, /--desk-tabbar-h/);
    assert.match(constitution, /bottom tab bar/);
    assert.match(constitution, /do not live in a hamburger drawer/);
    const hint = read("dashboard/src/components/ui/DeskHint.tsx");
    assert.match(hint, /createPortal/);
    assert.match(hint, /role="tooltip"/);
    assert.match(hint, /data-desk-hint=\{label\}/);
    assert.match(hint, /bg-\[#0A192F\]/);
    assert.match(hint, /onPointerEnter/);
    assert.match(hint, /Escape/);
  });

  it("overlays the Inbox count on the tab icon, not as a second control", () => {
    assert.match(nav, /export function DeskTabBar/);
    assert.match(nav, /needsCount = 0/);
    assert.match(nav, /<TabIconWithBadge name=\{item\.label\} count=\{needsCount\} \/>/);
    assert.match(nav, /formatInboxNavAriaLabel\(needsCount\)/);
    assert.match(nav, /deskNavBadgeClass/);
    assert.match(nav, /min-h-12/);
    assert.doesNotMatch(nav, /deskStatusChipClass/);
    const start = nav.indexOf("function TabIconWithBadge");
    const end = nav.indexOf("function inboxLinkAria");
    const badgeBlock = nav.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(badgeBlock, /pointer-events-none/);
    assert.match(badgeBlock, /relative inline-flex overflow-visible/);
    assert.doesNotMatch(badgeBlock, /<Link/);
    assert.doesNotMatch(badgeBlock, /inset-0/);
  });
});
