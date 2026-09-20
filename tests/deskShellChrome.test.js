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

function formatInboxNavAriaLabel(count) {
  const needs = formatAttentionCountAriaLabel(count);
  return needs ? `Inbox, ${needs}` : null;
}

describe("desk shell chrome", () => {
  const helper = read("dashboard/src/lib/deskAttentionCount.ts");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const layout = read("dashboard/src/app/(desk)/layout.tsx");
  const load = read("dashboard/src/lib/inboxLoad.ts");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const homeHeader = read("dashboard/src/components/HomeOverviewHeader.tsx");
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
    assert.equal(formatInboxNavAriaLabel(0), null);
    assert.equal(formatInboxNavAriaLabel(3), "Inbox, 3 need you");
    assert.equal(formatInboxNavAriaLabel(12), "Inbox, 9+ need you");
    assert.match(helper, /export function formatAttentionCount/);
    assert.match(helper, /n > 9 \? "9\+" : String\(n\)/);
    assert.match(helper, /\$\{display\} need you/);
    assert.match(helper, /Inbox, \$\{needs\}/);
    assert.doesNotMatch(helper, /items in your inbox/i);
  });

  it("drops the I need you subtitle and page-head count chip", () => {
    assert.doesNotMatch(toolbar, /pageTitleClass.*Inbox|Inbox.*pageTitleClass/);
    assert.doesNotMatch(toolbar, /\{archived \? "Archived" : "Inbox"\}/);
    assert.doesNotMatch(toolbar, /I need you/);
    assert.doesNotMatch(toolbar, /caption\?:/);
    assert.doesNotMatch(calls, /inboxCaption\(/);
    assert.doesNotMatch(toolbar, /formatAttentionCount/);
    assert.doesNotMatch(toolbar, /deskStatusChipClass/);
    assert.doesNotMatch(toolbar, /purpose: "needs"/);
    assert.match(toolbar, /<InboxFilterPills/);
    assert.match(toolbar, /<h1 className=\{pageTitleClass\}>Archived<\/h1>/);
  });

  it("overlays the Needs you count on the Inbox nav icon", () => {
    assert.match(nav, /needsCount = 0/);
    assert.match(nav, /formatAttentionCount\(needsCount\)/);
    assert.match(nav, /formatInboxNavAriaLabel\(needsCount\)/);
    assert.match(nav, /deskNavBadgeClass/);
    assert.match(nav, /pointer-events-none/);
    assert.match(nav, /TabIconWithBadge/);
    assert.match(chrome, /export const deskNavBadgeClass/);
    assert.match(chrome, /h-4 min-w-4/);
    assert.match(chrome, /-top-1 -end-1/);
    assert.match(chrome, /bg-gradient-to-br from-accent to-accent-fill/);
    assert.match(chrome, /text-accent-on-fill/);
    assert.doesNotMatch(chrome, /deskNavBadgeClass =\s*"[^"]*h-5/);
    assert.doesNotMatch(chrome, /deskNavBadgeClass =\s*"[^"]*inset-0/);
    assert.doesNotMatch(chrome, /deskNavBadgeClass =\s*"[^"]*bg-warn/);
    assert.doesNotMatch(chrome, /deskNavBadgeClass =\s*"[^"]*bg-accent-fill/);
    assert.match(layout, /DeskRailLive/);
    assert.match(layout, /DeskTabBarLive/);
    assert.match(layout, /loadCachedInboxNeedsCount/);
    assert.match(load, /countInboxPurposes\(inbox\.items\)\.needs/);
    assert.match(nav, /href=\{item\.href\}/);
    assert.doesNotMatch(nav, /callsHref\(\{ purpose: "needs"/);
  });

  it("puts large DESK_LINKS titles on list roots only", () => {
    const constitution = read("docs/frontend/FRONTEND_CONSTITUTION.md");
    const master = read("docs/frontend/design-system/MASTER.md");
    assert.match(chrome, /export const deskListTitleClass/);
    assert.match(chrome, /deskListTitleClass =\s*\n\s*"font-display text-3xl/);
    assert.match(chrome, /sm:text-4xl/);
    assert.match(constitution, /deskListTitleClass/);
    assert.match(master, /deskListTitleClass/);
    assert.doesNotMatch(constitution, /have no product wordmark and no page-name/);
    assert.match(toolbar, /<h1 className=\{deskListTitleClass\}>Inbox<\/h1>/);
    assert.doesNotMatch(toolbar, /pageTitleClass.*Inbox|Inbox.*pageTitleClass/);
    assert.match(toolbar, /<h1 className=\{pageTitleClass\}>Archived<\/h1>/);
    assert.match(contacts, /<h1 className=\{deskListTitleClass\}>Contacts<\/h1>/);
    assert.match(wallet, /<h1 className=\{deskListTitleClass\}>Usage<\/h1>/);
    assert.doesNotMatch(wallet, /<h1 className=\{deskListTitleClass\}>Wallet<\/h1>/);
    assert.doesNotMatch(home, />Overview</);
    assert.match(home, /HomeOverviewHeader/);
    assert.match(homeHeader, /deskListTitleClass/);
    assert.doesNotMatch(home, /pageTitleClass/);
    assert.match(settingsShell, /<SettingsPageHeader[\s\S]*?index/);
    assert.doesNotMatch(
      settingsUi,
      /<p className="font-sans text-\[11px\] font-semibold uppercase tracking-\[0\.14em\] text-ink-soft">\s*Business Profile\s*<\/p>/
    );
    assert.doesNotMatch(
      settingsUi,
      /<h1 className="mt-1 font-display text-\[clamp\(1\.5rem,2\.4vw,2rem\)\]/
    );
    assert.doesNotMatch(settingsUi, /deskListTitleClass/);

    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const ticketHeader = ticket.slice(ticket.indexOf("<header"), ticket.indexOf("</header>"));
    assert.match(ticketHeader, /<DeskBack href=\{backHref\}>Inbox<\/DeskBack>/);
    assert.doesNotMatch(ticketHeader, /deskListTitleClass/);
    assert.doesNotMatch(ticketHeader, /<h1[\s\S]{0,120}>Inbox<\/h1>/);
    assert.doesNotMatch(ticketHeader, /BrandLockup|BrandWordmark/);

    const contactFile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    assert.match(contactFile, /<DeskBack href=\{backHref\}>\{backLabel\}<\/DeskBack>/);
    assert.doesNotMatch(contactFile, /deskListTitleClass/);
    assert.doesNotMatch(contactFile, /<h1[\s\S]{0,120}>Contacts<\/h1>/);
    assert.doesNotMatch(contactFile, /BrandLockup|BrandWordmark/);

    const contactImport = read("dashboard/src/app/(desk)/contacts/import/page.tsx");
    assert.match(contactImport, /<DeskBack href="\/contacts">Contacts<\/DeskBack>/);
    assert.doesNotMatch(contactImport, /deskListTitleClass/);
    assert.doesNotMatch(contactImport, /<h1[\s\S]{0,120}>Contacts<\/h1>/);
  });

  it("drops the phone lockup, keeps tabs, and parks Sign out on Profile", () => {
    const css = read("dashboard/src/app/globals.css");
    const signOut = read("dashboard/src/components/ui/SignOutButton.tsx");
    assert.doesNotMatch(layout, /DeskPhoneHeader/);
    assert.match(layout, /DeskTabBar/);
    assert.match(css, /--desk-header-h:\s*0px/);
    assert.doesNotMatch(nav, /SignOutButton/);
    assert.match(signOut, /action="\/api\/logout"/);
    assert.match(signOut, />\s*Sign out\s*</);
    assert.match(settingsUi, /SignOutButton/);
    assert.match(settingsUi, />Profile</);
    assert.match(settingsShell, /<SignOutButton/);
    assert.doesNotMatch(home, /Sign out/);
    assert.match(home, /HomeOverviewHeader/);
    assert.match(homeHeader, /BrandLockup/);
    assert.match(homeHeader, /name="Scalers"/);
    assert.match(homeHeader, /size="xs"/);
    assert.match(homeHeader, /markOnly/);
    assert.match(homeHeader, /md:hidden/);
    assert.match(homeHeader, /href=\{null\}/);
    assert.match(homeHeader, /aria-label=\{`Scalers\. \$\{business\}`\}/);
    assert.doesNotMatch(homeHeader, /size="sm"/);
    assert.doesNotMatch(homeHeader, /size="lg"/);
    assert.doesNotMatch(home, /BrandLockup/);
    assert.doesNotMatch(home, /nairobiGreeting/);
    assert.doesNotMatch(home, /pageTitleClass/);
    assert.doesNotMatch(contacts, /BrandLockup/);
    assert.doesNotMatch(wallet, /BrandLockup/);
    assert.match(wallet, /Could not load Usage/);
    assert.doesNotMatch(wallet, /Could not load wallet/);
  });
});
