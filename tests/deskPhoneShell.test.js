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
    assert.match(nav, /label: "Wallet"/);
    assert.doesNotMatch(nav, /Menu/);
    assert.doesNotMatch(nav, /hamburger/i);
    assert.match(layout, /DeskTabBar/);
    assert.match(layout, /--desk-tabbar-h/);
    assert.match(layout, /safe-area-inset-bottom/);
    assert.match(root, /viewportFit:\s*"cover"/);
    assert.match(css, /--desk-tabbar-h:\s*3\.25rem/);
    assert.match(player, /--desk-tabbar-h/);
    assert.match(constitution, /bottom tab bar/);
    assert.match(constitution, /do not live in a hamburger drawer/);
  });
});
