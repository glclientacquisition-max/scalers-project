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
    assert.match(overflow, /id: "select"/);
    assert.match(overflow, /ui\?\.enter\(item\.id\)/);
    assert.match(ui, /enter:/);
    assert.match(ui, /toggle:/);
  });

  it("loops the same per-row handlers for bulk Mark done and Archive", () => {
    assert.match(select, /for \(const item of chosen\)/);
    assert.match(select, /inboxMarkDone\(item\)/);
    assert.match(select, /inboxArchive\(item\)/);
    assert.doesNotMatch(select, /inboxDelete/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "resolved"\)/);
    assert.match(select, />\s*Cancel\s*</);
    assert.match(select, /\{chosen\.length\} selected/);
  });

  it("shows a WhatsApp-style phone action bar with pin, archive, done, and more", () => {
    assert.match(select, /aria-label="Back"/);
    assert.match(select, /aria-label=\{allPinned \? "Unpin" : "Pin"\}/);
    assert.match(select, /aria-label="Archive"/);
    assert.match(select, /aria-label="Mark done"/);
    assert.match(select, /aria-label="More"/);
    assert.match(select, /inboxTogglePin\(item\)/);
    assert.match(select, /inboxToggleRead\(item\)/);
    assert.match(select, /inboxSnooze\(item\)/);
    assert.match(select, /md:hidden/);
    assert.match(select, /hidden md:flex|md:flex md:static/);
    assert.match(select, /max-md:hidden/);
    assert.match(select, /flex-col justify-end/);
    assert.match(select, /h-dvh/);
    assert.match(select, /role="dialog"/);
  });

  it("toggles the row instead of opening the ticket while selecting", () => {
    assert.match(select, /Toggle selection/);
    assert.match(select, /ui\.selecting/);
    assert.match(overflow, /if \(ui\?\.selecting\) return;/);
  });
});
