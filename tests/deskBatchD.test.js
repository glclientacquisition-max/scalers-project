const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk batch D screen fit and recovery", () => {
  it("keeps the ticket dock inside the column", () => {
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const nav = read("dashboard/src/components/DeskNav.tsx");
    const css = read("dashboard/src/app/globals.css");
    assert.match(ticket, /h-full min-h-0 flex-1 flex-col/);
    assert.match(ticket, /pt-\[var\(--desk-header-h\)\]/);
    assert.match(ticket, /pb-\[env\(safe-area-inset-bottom,0px\)\]/);
    assert.doesNotMatch(ticket, /100dvh-var\(--desk-header-h\)/);
    assert.doesNotMatch(nav, /has-\[\[data-desk-bleed\]\]:overflow-hidden/);
    assert.doesNotMatch(nav, /has-\[\[data-desk-bleed\]\]:h-full/);
    assert.match(css, /data-desk-ticket-chat\] \[data-desk-main\]/);
    assert.match(css, /height:\s*100%/);
    assert.match(css, /overflow:\s*hidden/);
    assert.match(css, /--desk-tabbar-clearance:\s*env\(safe-area-inset-bottom, 0px\)/);
  });

  it("opens owner overlays as a bottom drawer with a 44px close", () => {
    const dialog = read("dashboard/src/components/ui/DeskDialog.tsx");
    const sheet = read("dashboard/src/components/ui/Sheet.tsx");
    assert.match(dialog, /<Sheet/);
    assert.match(dialog, /dismissible=\{!pending\}/);
    assert.match(sheet, /swipeDirection="down"/);
    assert.match(sheet, /desk-drawer/);
    assert.match(sheet, /items-end/);
    assert.match(sheet, /h-11 w-11/);
    assert.doesNotMatch(sheet, /framer-motion|motion\/react/);
    assert.doesNotMatch(dialog, /shadow-xl|landing-rise|animate-|transition-opacity|scale-/);
  });

  it("gives empty lists one next step", () => {
    const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
    const form = read("dashboard/src/components/TenantForm.tsx");
    const history = read("dashboard/src/components/ContactHistory.tsx");
    const inbox = read("dashboard/src/components/InboxPileBoard.tsx");
    assert.match(contacts, />\s*Import\s*</);
    assert.match(contacts, />\s*Show all\s*</);
    assert.match(contacts, /lg:flex-row/);
    assert.doesNotMatch(contacts, /md:flex-row/);
    assert.doesNotMatch(form, /No products yet/);
    assert.doesNotMatch(form, /No contacts yet/);
    assert.match(form, /Add product/);
    assert.match(form, /Add phone/);
    assert.match(history, />\s*Show all\s*</);
    assert.match(history, /No calls or jobs yet/);
    assert.match(inbox, /Inbox is empty/);
    assert.match(inbox, />\s*Show all\s*</);
  });

  it("puts Work before the aside and Updates on the phone source order", () => {
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    const work = home.indexOf('id="work-heading"');
    const aside = home.indexOf("<aside");
    const updates = home.indexOf('id="updates-heading"');
    assert.ok(work >= 0 && aside > work && updates > aside);
    assert.match(home, /lg:col-span-7 lg:col-start-1 lg:row-start-1/);
    assert.match(home, /lg:row-span-2 lg:row-start-1/);
    assert.match(home, /returnSidebar/);
    assert.match(home, /DeskLoadError/);
    assert.match(home, /Could not load Overview/);
    const note = read("docs/frontend/design-system/pages/home.md");
    assert.match(note, /Work, then aside, then Updates/);
  });

  it("retries load failures in place", () => {
    const retry = read("dashboard/src/components/ui/DeskLoadError.tsx");
    assert.match(retry, />\s*Retry\s*</);
    assert.match(retry, /refresh\(\)/);
    for (const file of [
      "dashboard/src/app/(desk)/home/page.tsx",
      "dashboard/src/app/(desk)/calls/page.tsx",
      "dashboard/src/app/(desk)/calls/[id]/page.tsx",
      "dashboard/src/app/(desk)/contacts/page.tsx",
      "dashboard/src/app/(desk)/contacts/[id]/page.tsx",
      "dashboard/src/app/(desk)/settings/page.tsx",
      "dashboard/src/app/(desk)/wallet/page.tsx",
    ]) {
      assert.match(read(file), /DeskLoadError/);
    }
    assert.match(read("dashboard/src/components/ui/deskChrome.ts"), /pe-8/);
    assert.match(
      read("dashboard/src/components/ui/DeskDataTable.tsx"),
      /\[&_th\]:whitespace-nowrap/
    );
  });
});
