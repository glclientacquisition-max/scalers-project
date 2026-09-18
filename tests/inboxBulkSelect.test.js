const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox bulk select", () => {
  const select = read("dashboard/src/components/InboxRowSelect.tsx");
  const ui = read("dashboard/src/components/InboxRowUi.tsx");
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");

  it("enters selection from a hover checkbox, Select, or touch long-press", () => {
    assert.match(select, /type="checkbox"/);
    assert.match(select, /sr-only/);
    assert.match(select, /Select \{who\}/);
    assert.match(read("dashboard/src/lib/inboxListVerbs.ts"), /id: "select"/);
    assert.match(overflow, /inboxOverflowActions\(item\)/);
    assert.match(overflow, /ui\?\.enter\(item\.id\)/);
    assert.match(ui, /enter:/);
    assert.match(ui, /toggle:/);
  });

  it("loops the same per-row handlers for bulk Mark done and Archive", () => {
    assert.match(select, /for \(const item of chosen\)/);
    assert.match(select, /inboxMarkDone\(item\)/);
    assert.match(select, /inboxArchive\(item\)/);
    assert.match(select, /inboxUnarchive\(item\)/);
    assert.doesNotMatch(select, /inboxDelete/);
    assert.doesNotMatch(select, /inboxToggleRead/);
    assert.doesNotMatch(select, /inboxSnooze/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "resolved"\)/);
    assert.match(select, />\s*Cancel\s*</);
    assert.match(select, /\{chosen\.length\} selected/);
  });

  it("shows a WhatsApp-style phone action bar with pin, archive, and done", () => {
    assert.match(select, /aria-label="Back"/);
    assert.match(select, /aria-label=\{allPinned \? "Unpin" : "Pin"\}/);
    assert.match(select, /aria-label=\{allArchived \? "Unarchive" : "Archive"\}/);
    assert.match(select, /aria-label="Mark done"/);
    assert.doesNotMatch(select, /aria-label="More"/);
    assert.doesNotMatch(select, /role="dialog"/);
    assert.match(select, /inboxTogglePin\(item\)/);
    assert.match(select, /md:hidden/);
    assert.match(select, /hidden md:flex|md:flex md:static/);
    assert.match(select, /max-md:hidden/);
    assert.match(select, /kind === "archive" \|\| kind === "unarchive"/);
    assert.doesNotMatch(select, /kind === "done" \|\| kind === "archive" \|\| kind === "snooze"/);
  });

  it("toggles the row instead of opening the ticket while selecting", () => {
    assert.match(select, /Toggle selection/);
    assert.match(select, /ui\.selecting/);
    assert.match(overflow, /if \(ui\?\.selecting\) return;/);
  });
});
