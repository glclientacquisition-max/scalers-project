const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const helperPath = path.join(__dirname, "../dashboard/src/lib/deskTicketChat.ts");

function loadHelper() {
  const script = `
    import { isDeskNestedPath, isDeskTicketChatPath } from ${JSON.stringify(helperPath)};
    const cases = {
      home: isDeskNestedPath("/home"),
      inbox: isDeskNestedPath("/calls"),
      archived: isDeskNestedPath("/calls", "purpose=archived"),
      ticket: isDeskNestedPath("/calls/abc-123"),
      ticketSlash: isDeskNestedPath("/calls/abc-123/"),
      ticketQuery: isDeskNestedPath("/calls/abc-123?from=needs"),
      ticketEdit: isDeskNestedPath("/calls/abc-123/edit"),
      contacts: isDeskNestedPath("/contacts"),
      contactFile: isDeskNestedPath("/contacts/abc-123"),
      contactFileSlash: isDeskNestedPath("/contacts/abc-123/"),
      contactFileQuery: isDeskNestedPath("/contacts/abc-123?from=contacts"),
      contactImport: isDeskNestedPath("/contacts/import"),
      devContactFile: isDeskNestedPath("/dev/contacts/file"),
      wallet: isDeskNestedPath("/wallet"),
      settingsHub: isDeskNestedPath("/settings"),
      settingsHubSearch: isDeskNestedPath("/settings", ""),
      settingsMenu: isDeskNestedPath("/settings", "tab=menu"),
      settingsUnknown: isDeskNestedPath("/settings", "tab=hours"),
      settingsAppearance: isDeskNestedPath("/settings", "tab=appearance"),
      settingsTrain: isDeskNestedPath("/settings", "?tab=train&panel=hours"),
      settingsBareTicket: isDeskTicketChatPath("/contacts/abc-123"),
      empty: isDeskNestedPath(""),
      nil: isDeskNestedPath(null),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("desk nested tab hide", () => {
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const css = read("dashboard/src/app/globals.css");
  const helper = read("dashboard/src/lib/deskTicketChat.ts");
  const contactFile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const contactImport = read("dashboard/src/app/(desk)/contacts/import/page.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const settings = read("dashboard/src/components/BusinessSettingsShell.tsx");
  const constitution = read("docs/frontend/FRONTEND_CONSTITUTION.md");
  const master = read("docs/frontend/design-system/MASTER.md");
  const contactsNote = read("docs/frontend/design-system/pages/contacts.md");
  const settingsNote = read("docs/frontend/design-system/pages/settings.md");

  it("hides tabs on nested insides and keeps them on list roots", () => {
    const got = loadHelper();
    assert.equal(got.home, false);
    assert.equal(got.inbox, false);
    assert.equal(got.archived, false);
    assert.equal(got.ticket, true);
    assert.equal(got.ticketSlash, true);
    assert.equal(got.ticketQuery, true);
    assert.equal(got.ticketEdit, false);
    assert.equal(got.contacts, false);
    assert.equal(got.contactFile, true);
    assert.equal(got.contactFileSlash, true);
    assert.equal(got.contactFileQuery, true);
    assert.equal(got.contactImport, true);
    assert.equal(got.devContactFile, true);
    assert.equal(got.wallet, false);
    assert.equal(got.settingsHub, false);
    assert.equal(got.settingsHubSearch, false);
    assert.equal(got.settingsMenu, false);
    assert.equal(got.settingsUnknown, false);
    assert.equal(got.settingsAppearance, true);
    assert.equal(got.settingsTrain, true);
    assert.equal(got.settingsBareTicket, false);
    assert.equal(got.empty, false);
    assert.equal(got.nil, false);
    assert.match(helper, /export function isDeskNestedPath/);
    assert.match(nav, /isDeskNestedPath\(pathname\)/);
    assert.match(nav, /return null/);
    assert.match(nav, /md:hidden/);
    assert.match(nav, /export function DeskRail/);
    assert.match(nav, /md:flex/);
  });

  it("marks contact file, import, and Profile nested panels for CSS hide", () => {
    assert.match(contactFile, /data-desk-nested/);
    assert.match(contactFile, /<DeskBack href=\{backHref\}>\{backLabel\}<\/DeskBack>/);
    assert.match(contactImport, /data-desk-nested/);
    assert.match(contactImport, /<DeskBack href="\/contacts">Contacts<\/DeskBack>/);
    const devFile = read("dashboard/src/app/dev/contacts/file/page.tsx");
    assert.match(devFile, /data-desk-nested/);
    assert.match(devFile, /<DeskBack href="\/dev\/contacts">Contacts<\/DeskBack>/);
    assert.match(ticket, /data-ticket-chat/);
    assert.match(settings, /data-settings-console="" data-desk-nested=""/);
    const menuStart = settings.indexOf("if (isMenu)");
    const nestedMark = settings.indexOf('data-settings-console="" data-desk-nested=""');
    assert.ok(menuStart >= 0 && nestedMark > menuStart);
    assert.doesNotMatch(settings.slice(menuStart, nestedMark), /data-desk-nested/);
    assert.match(css, /desk-theme:has\(\[data-ticket-chat\]\)/);
    assert.match(css, /desk-theme:has\(\[data-desk-nested\]\)/);
    assert.match(css, /--desk-tabbar-h:\s*0px/);
    assert.match(css, /\[data-desk-tabbar\]/);
  });

  it("documents the hide on nested insides, not list roots", () => {
    assert.match(constitution, /hide below `md` on nested insides/);
    assert.match(constitution, /contact file/);
    assert.doesNotMatch(constitution, /Bottom tabs stay on nested screens except/);
    assert.match(master, /Hidden below `md` on nested insides/);
    assert.doesNotMatch(master, /Stays on nested contact screens/);
    assert.match(contactsNote, /data-desk-nested/);
    assert.match(settingsNote, /data-desk-nested/);
    assert.match(settingsNote, /Profile hub keeps tabs/);
  });
});
