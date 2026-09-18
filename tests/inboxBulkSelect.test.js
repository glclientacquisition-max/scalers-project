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

  it("enters selection from a hover checkbox or Select", () => {
    assert.match(select, /type="checkbox"/);
    assert.match(select, /sr-only/);
    assert.match(select, /Select \{who\}/);
    assert.match(overflow, /id: "select"/);
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

  it("toggles the row instead of opening the ticket while selecting", () => {
    assert.match(select, /Toggle selection/);
    assert.match(select, /ui\.selecting/);
    assert.match(overflow, /if \(ui\?\.selecting\) return;/);
  });
});
