const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function placeInboxOverflowMenu(panel, anchor, viewport) {
  const pad = 8;
  const gap = 4;
  let left;
  let top;
  if (anchor.align === "end") {
    const triggerRight = anchor.x + (anchor.w ?? 0);
    const triggerBottom = anchor.y + (anchor.h ?? 0);
    left = triggerRight - panel.width;
    top = triggerBottom + gap;
    const above = anchor.y - panel.height - gap;
    if (top + panel.height > viewport.height - pad && above >= pad) {
      top = above;
    }
  } else {
    left = anchor.x;
    top = anchor.y;
    if (left + panel.width > viewport.width - pad) {
      left = anchor.x - panel.width;
    }
    if (top + panel.height > viewport.height - pad) {
      top = anchor.y - panel.height;
    }
  }
  const maxLeft = Math.max(pad, viewport.width - panel.width - pad);
  const maxTop = Math.max(pad, viewport.height - panel.height - pad);
  left = Math.min(Math.max(left, pad), maxLeft);
  top = Math.min(Math.max(top, pad), maxTop);
  return { left, top };
}

describe("inbox row overflow menu", () => {
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const lead = read("dashboard/src/components/MarkLeadDoneButton.tsx");
  const row = read("dashboard/src/components/InboxItemRow.tsx");
  const place = read("dashboard/src/lib/inboxOverflowPlace.ts");

  it("reuses the ticket Archive handler plus Pin and Mark done", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(lead, /updateLeadStatus\(callId, action\)/);
    assert.match(overflow, /inboxArchive/);
    assert.match(overflow, /inboxUnarchive/);
    assert.match(overflow, /inboxMarkDone/);
    assert.match(overflow, /inboxTogglePin\(item\)/);
  });

  it("opens a custom menu on md+ and selects on long-press, with no phone sheet", () => {
    assert.match(overflow, /LONG_PRESS_MS = 500/);
    assert.match(overflow, /role="menuitem"/);
    assert.match(overflow, /aria-haspopup="menu"/);
    assert.match(overflow, /onContextMenu/);
    assert.match(overflow, /pointerType !== "touch"/);
    assert.match(overflow, /ui\?\.enter\(item\.id\)/);
    assert.match(overflow, /onClickCapture/);
    assert.match(overflow, /hidden md:inline-flex/);
    assert.doesNotMatch(overflow, /coarse \? "sheet" : "menu"/);
    assert.doesNotMatch(overflow, /role="dialog"/);
    assert.doesNotMatch(overflow, /mode === "sheet"/);
    assert.doesNotMatch(overflow, /onContextMenu=\{undefined\}/);
  });

  it("keeps the trailing dock and Pin, Mark done, Archive overflow", () => {
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(row, /InboxRowMore/);
    assert.match(row, /InboxTrailingAction/);
    assert.ok(row.indexOf("<InboxRowMore") < row.indexOf("<InboxTrailingAction"), "more sits left of dock");
    assert.match(verbs, /label: "Archive"/);
    assert.match(verbs, /label: "Unarchive"/);
    assert.match(verbs, /label: "Pin"/);
    assert.match(verbs, /label: "Unpin"/);
    assert.match(verbs, /Mark done/);
    assert.doesNotMatch(verbs, /label: "Select"/);
    assert.match(overflow, /inboxOverflowActions\(item\)/);
    assert.doesNotMatch(overflow, /id: "unread"/);
    assert.doesNotMatch(overflow, /id: "snooze"/);
    assert.doesNotMatch(overflow, /Mark unread/);
    assert.doesNotMatch(verbs, /Snooze/);
    assert.doesNotMatch(verbs, /Mark unread/);
    assert.doesNotMatch(overflow, /Mute/);
    assert.doesNotMatch(overflow, /Assign to teammate/);
    assert.doesNotMatch(overflow, /Add label/);
    assert.doesNotMatch(overflow, /id: "delete"/);
    assert.doesNotMatch(overflow, /inboxDelete/);
    assert.match(overflow, /if \(id === "archive" \|\| id === "unarchive"\) \{\n      patch\(\{ hidden: true \}\);/);
    assert.doesNotMatch(overflow, /id === "mark_done"[\s\S]{0,400}patch\(\{ hidden/);
  });

  it("closes after a successful run and keeps the menu on desk tokens", () => {
    assert.match(overflow, /busyRef\.current = true/);
    assert.match(overflow, /setOpen\(false\)/);
    assert.match(overflow, /createPortal\(<div className="desk-theme">\{menu\}<\/div>, document.body\)/);
    assert.match(overflow, /pendingId === action.id \? "Saving"/);
    assert.doesNotMatch(overflow, /\{busy \? "Saving" : action.label\}/);
    assert.doesNotMatch(overflow, /close\(\);\n    router.refresh/);
  });

  it("marks pinned rows next to time, not as Favourites", () => {
    const mark = read("dashboard/src/components/ui/deskRow.tsx");
    assert.match(row, /InboxPinMark show=\{Boolean\(item\.pinnedAt\)\}/);
    assert.match(mark, /export function InboxPinMark/);
    assert.match(mark, /data-inbox-pin/);
    assert.match(mark, /aria-label="Pinned"/);
    assert.doesNotMatch(row, /Favorites/);
    assert.doesNotMatch(row, /favourite_at/);
  });

  it("right-aligns More to the trigger instead of covering Call and WhatsApp", () => {
    assert.match(overflow, /placeInboxOverflowMenu/);
    assert.match(overflow, /align: "end"/);
    assert.match(overflow, /visualViewport/);
    assert.match(overflow, /offsetHeight/);
    assert.match(overflow, /inline-flex/);
    assert.match(overflow, /max-h-\[min\(24rem/);
    assert.doesNotMatch(overflow, /innerHeight - 320/);
    assert.doesNotMatch(overflow, /max-h-\[80vh\]/);
    assert.match(place, /triggerRight - panel.width/);
    const panel = { width: 224, height: 248 };
    const more = placeInboxOverflowMenu(
      panel,
      { x: 900, y: 200, w: 48, h: 48, align: "end" },
      { width: 1280, height: 800 }
    );
    assert.equal(more.left, 724);
    assert.equal(more.top, 252);
    assert.ok(more.left + panel.width <= 900 + 48);
    const low = placeInboxOverflowMenu(
      panel,
      { x: 900, y: 700, w: 48, h: 48, align: "end" },
      { width: 1280, height: 800 }
    );
    assert.equal(low.top, 448);
    const point = placeInboxOverflowMenu(
      panel,
      { x: 1200, y: 100, align: "point" },
      { width: 1280, height: 800 }
    );
    assert.equal(point.left, 976);
  });
});
