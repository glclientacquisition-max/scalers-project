const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

/** Mirror of dashboard/src/lib/deskAttentionCount.ts. Keep in lockstep. */
function formatAttentionCount(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  return n > 9 ? "9+" : String(n);
}

function formatAttentionCountAriaLabel(count) {
  const display = formatAttentionCount(count);
  if (!display) return null;
  return `${display} need you`;
}

describe("desk shell chrome", () => {
  const helper = read("dashboard/src/lib/deskAttentionCount.ts");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const wallet = read("dashboard/src/app/(desk)/wallet/page.tsx");
  const settingsUi = read("dashboard/src/components/settingsUi.tsx");
  const settingsShell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  const chrome = read("dashboard/src/components/ui/deskChrome.ts");

  it("caps the Needs you chip at 9+", () => {
    assert.equal(formatAttentionCount(0), null);
    assert.equal(formatAttentionCount(-1), null);
    assert.equal(formatAttentionCount(1), "1");
    assert.equal(formatAttentionCount(9), "9");
    assert.equal(formatAttentionCount(10), "9+");
    assert.equal(formatAttentionCount(99), "9+");
    assert.equal(formatAttentionCountAriaLabel(0), null);
    assert.equal(formatAttentionCountAriaLabel(3), "3 need you");
    assert.equal(formatAttentionCountAriaLabel(12), "9+ need you");
    assert.match(helper, /export function formatAttentionCount/);
    assert.match(helper, /n > 9 \? "9\+" : String\(n\)/);
    assert.match(helper, /\$\{display\} need you/);
    assert.doesNotMatch(helper, /items in your inbox/i);
  });

  it("drops the Inbox H1 and I need you subtitle for a Needs you chip", () => {
    assert.doesNotMatch(toolbar, /pageTitleClass.*Inbox|Inbox.*pageTitleClass/);
    assert.doesNotMatch(toolbar, /\{archived \? "Archived" : "Inbox"\}/);
    assert.doesNotMatch(toolbar, /I need you/);
    assert.doesNotMatch(toolbar, /caption\?:/);
    assert.doesNotMatch(calls, /inboxCaption\(/);
    assert.match(toolbar, /formatAttentionCount\(counts\.needs\)/);
    assert.match(toolbar, /purpose: "needs"/);
    assert.match(toolbar, /deskStatusChipClass/);
    assert.match(chrome, /export const deskStatusChipClass/);
    assert.match(chrome, /min-h-11/);
    assert.match(chrome, /tabular-nums/);
    assert.match(toolbar, /<h1 className=\{pageTitleClass\}>Archived<\/h1>/);
  });

  it("does not repeat DESK_LINKS names as index headings", () => {
    assert.doesNotMatch(home, /pageTitleClass/);
    assert.doesNotMatch(home, />Overview</);
    assert.doesNotMatch(contacts, /pageTitleClass/);
    assert.doesNotMatch(contacts, /<h1 className=\{pageTitleClass\}>\s*Contacts/);
    assert.doesNotMatch(wallet, /pageTitleClass/);
    assert.doesNotMatch(wallet, /<h1 className=\{pageTitleClass\}>Wallet<\/h1>/);
    assert.match(settingsShell, /<SettingsPageHeader[\s\S]*?index/);
    assert.doesNotMatch(
      settingsUi,
      /<p className="font-sans text-\[11px\] font-semibold uppercase tracking-\[0\.14em\] text-ink-soft">\s*Business Profile\s*<\/p>/
    );
    assert.doesNotMatch(
      settingsUi,
      /<h1 className="mt-1 font-display text-\[clamp\(1\.5rem,2\.4vw,2rem\)\]/
    );
  });
});
