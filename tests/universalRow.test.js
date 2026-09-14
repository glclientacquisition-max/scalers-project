// Universal conversation row: identity circle, state dot, weight-by-state.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("universal row anatomy", () => {
  const row = read("dashboard/src/components/ui/deskRow.tsx");
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const master = read("docs/frontend/design-system/MASTER.md");

  it("ships the shared primitives", () => {
    assert.match(row, /export function RowIdentity/);
    assert.match(row, /export function RowStateDot/);
    assert.match(row, /export function deskRowInitials/);
    assert.match(row, /export function deskRowWeightClass/);
    assert.match(master, /RowIdentity/);
    assert.match(master, /RowStateDot/);
  });

  it("keeps the identity circle neutral and state-free", () => {
    assert.match(row, /border border-line bg-surface-muted text-xs font-semibold text-ink-soft/);
    // No per-name rainbow: the circle never hashes a name into a color.
    assert.doesNotMatch(row, /hash|hsl\(|palette/i);
  });

  it("carries state as a blue dot plus type weight, never opacity", () => {
    assert.match(row, /rounded-full bg-\[#0096FF\]/);
    assert.match(row, /aria-label="Needs you"/);
    assert.match(row, /font-semibold text-ink/);
    assert.match(row, /font-medium text-ink/);
    assert.doesNotMatch(inbox, /opacity-\[0\.92\]/);
  });

  it("applies the anatomy to Inbox phone and table rows", () => {
    const uses = inbox.match(/RowIdentity/g) || [];
    assert.ok(uses.length >= 4, `RowIdentity in phone + 3 table kinds, got ${uses.length}`);
    assert.match(inbox, /RowStateDot show=\{item\.needsYou\}/);
    assert.match(inbox, /deskRowWeightClass\(item\.needsYou\)/);
    assert.match(inbox, /DeskRowHit/);
    assert.match(inbox, /label="Conversation"/);
  });

  it("applies the identity circle to Contacts mobile and desktop", () => {
    const uses = contacts.match(/RowIdentity/g) || [];
    assert.ok(uses.length >= 3, `import + mobile + desktop, got ${uses.length}`);
  });

  it("initials skip phone numbers and placeholders", () => {
    assert.match(row, /\^\\\+\?\[\\d\\s\(\)-\]/);
  });
});
