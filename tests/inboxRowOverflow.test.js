const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox row overflow menu", () => {
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const lead = read("dashboard/src/components/MarkLeadDoneButton.tsx");
  const row = read("dashboard/src/components/InboxItemRow.tsx");

  function inboxItemWithLocal(item, local) {
    if (local.pinnedAt === undefined) return item;
    return { ...item, pinnedAt: local.pinnedAt };
  }

  it("reuses the ticket Archive handler plus Pin and Mark done", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(lead, /updateLeadStatus\(callId, action\)/);
    assert.match(overflow, /inboxArchive/);
    assert.match(overflow, /inboxUnarchive/);
    assert.match(overflow, /inboxMarkDone/);
    assert.match(overflow, /inboxTogglePin\(view\)/);
  });

  it("opens kit Menu from More, selects on long-press, with no phone sheet", () => {
    assert.match(overflow, /LONG_PRESS_MS = 400/);
    assert.match(overflow, /isRowBodyPress/);
    assert.match(overflow, /data-inbox-row-body/);
    assert.match(overflow, /opacity-80/);
    assert.doesNotMatch(overflow, /transition-all/);
    assert.match(overflow, /<Menu/);
    assert.match(overflow, /<MenuItem/);
    assert.match(overflow, /<IconButton/);
    assert.match(overflow, /onContextMenu/);
    assert.match(overflow, /pointerType !== "touch"/);
    assert.match(overflow, /ui\?\.enter\(item\.id\)/);
    assert.match(overflow, /onClickCapture/);
    assert.doesNotMatch(overflow, /hidden md:inline-flex/);
    assert.doesNotMatch(overflow, /coarse \? "sheet" : "menu"/);
    assert.doesNotMatch(overflow, /role="dialog"/);
    assert.doesNotMatch(overflow, /mode === "sheet"/);
    assert.doesNotMatch(overflow, /onContextMenu=\{undefined\}/);
    assert.doesNotMatch(overflow, /createPortal/);
    assert.doesNotMatch(overflow, /placeInboxOverflowMenu/);
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
    assert.match(overflow, /inboxOverflowActions\(inboxItemWithLocal\(item, local\)\)/);
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
    assert.match(overflow, /pendingId === action.id \? "Saving"/);
    assert.doesNotMatch(overflow, /\{busy \? "Saving" : action.label\}/);
    assert.doesNotMatch(overflow, /close\(\);\n    router.refresh/);
  });

  it("marks pinned rows next to time, not as Favourites", () => {
    const mark = read("dashboard/src/components/ui/deskRow.tsx");
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(row, /InboxPinMark show=\{Boolean\(pinnedAt\)\}/);
    assert.match(row, /useInboxRowLocal\(item\.id\)/);
    assert.match(verbs, /export function inboxItemWithLocal/);
    assert.match(overflow, /if \(id === "pin"\) patch\(\{ pinnedAt:/);
    assert.match(overflow, /if \(id === "unpin"\) patch\(\{ pinnedAt: null \}\)/);
    assert.match(overflow, /inboxTogglePin\(view\)/);
    assert.match(mark, /export function InboxPinMark/);
    assert.match(mark, /data-inbox-pin/);
    assert.match(mark, /aria-label="Pinned"/);
    assert.doesNotMatch(row, /Favorites/);
    assert.doesNotMatch(row, /favourite_at/);
    assert.match(actions, /pathname.startsWith\("\/dev\/"\)/);
    const loose = { id: "human", pinnedAt: null };
    assert.equal(inboxItemWithLocal(loose, {}).pinnedAt, null);
    assert.ok(inboxItemWithLocal(loose, { pinnedAt: "2026-09-24T10:00:00.000Z" }).pinnedAt);
    assert.equal(inboxItemWithLocal({ ...loose, pinnedAt: "x" }, { pinnedAt: null }).pinnedAt, null);
  });

  it("lets kit Menu place More, always visible on phone", () => {
    assert.match(overflow, /from "@\/components\/ui\/Menu"/);
    assert.match(overflow, /from "@\/components\/ui\/IconButton"/);
    assert.match(overflow, /EllipsisVerticalIcon/);
    assert.doesNotMatch(overflow, /align: "end"/);
    assert.doesNotMatch(overflow, /visualViewport/);
  });
});
