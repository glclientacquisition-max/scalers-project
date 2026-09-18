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

  it("reuses ticket Mark done and Archive handlers", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId, "resolved"\)/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(lead, /updateLeadStatus\(callId, action\)/);
    assert.match(overflow, /inboxMarkDone/);
    assert.match(overflow, /inboxArchive/);
  });

  it("opens a custom menu on hover and a sheet on long-press", () => {
    assert.match(overflow, /LONG_PRESS_MS = 500/);
    assert.match(overflow, /role=\{mode === "sheet" \? "dialog" : "menu"\}/);
    assert.match(overflow, /role="menuitem"/);
    assert.match(overflow, /aria-haspopup="menu"/);
    assert.match(overflow, /onContextMenu/);
    assert.match(overflow, /pointerType !== "touch"/);
    assert.match(overflow, /min-h-11/);
    assert.doesNotMatch(overflow, /onContextMenu=\{undefined\}/);
  });

  it("keeps the trailing dock and lists every overflow verb", () => {
    assert.match(row, /InboxRowMore/);
    assert.match(row, /InboxTrailingAction/);
    assert.ok(row.indexOf("<InboxRowMore") < row.indexOf("<InboxTrailingAction"), "more sits left of dock");
    for (const label of [
      "Mark unread",
      "Mark done",
      "Archive",
      "Mute",
      "Pin",
      "Assign to teammate",
      "Add label",
      "Snooze",
      "Delete",
    ]) {
      assert.match(overflow, new RegExp(label));
    }
  });
});
