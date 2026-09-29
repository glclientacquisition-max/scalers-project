const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk density P1", () => {
  const header = read("dashboard/src/components/HomeOverviewHeader.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  const settingsUi = read("dashboard/src/components/settingsUi.tsx");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const niche = read("dashboard/src/lib/inboxNiche.ts");
  const contacts = read("dashboard/src/lib/contactsLoad.ts");
  const contactRow = read("dashboard/src/components/ContactListRow.tsx");
  const form = read("dashboard/src/components/TenantForm.tsx");
  const spark = read("dashboard/src/components/ContactSparkline.tsx");
  const nav = read("dashboard/src/lib/businessSettingsNav.ts");
  const importPage = read("dashboard/src/app/(desk)/contacts/import/page.tsx");
  const check = read("dashboard/src/components/InboxRowSelect.tsx");
  const board = read("dashboard/src/components/InboxPileBoard.tsx");
  const table = read("dashboard/src/components/InboxItemRow.tsx");

  it("keeps the account-bar name and drops the Home business h1", () => {
    assert.match(header, /BrandLockup/);
    assert.doesNotMatch(header, /<h1/);
    assert.doesNotMatch(header, /\{business\}/);
    assert.match(home, /<HomeOverviewHeader today=\{today\} \/>/);
  });

  it("keeps Return calls on the Work queue and skips the twin aside CTA", () => {
    const queues = home.slice(home.indexOf("const queues"), home.indexOf("let ctaHref"));
    assert.match(queues, /label: copy\.returnCtaMany/);
    assert.match(home, /const returnSidebar =/);
    assert.match(home, /ctaLabel === copy\.returnCtaOne \|\| ctaLabel === copy\.returnCtaMany/);
    assert.match(home, /const showCta = !\(line === "pending" && waitingCount === 0\) && !returnSidebar/);
  });

  it("signs out from the account bar only", () => {
    assert.doesNotMatch(shell, /SignOutButton/);
    assert.match(read("dashboard/src/components/DeskAccountBar.tsx"), /<SignOutButton/);
  });

  it("shows Line live on Test and not on Appearance or other settings headers", () => {
    assert.match(settingsUi, /showLine = false/);
    assert.match(settingsUi, /const line = showLine \?/);
    assert.match(shell, /showLine=\{tab === "test"\}/);
    assert.doesNotMatch(form, /showLine/);
    assert.match(settingsUi, /Line live/);
    assert.match(settingsUi, /Number pending/);
  });

  it("drops the static Call or WhatsApp work line", () => {
    assert.doesNotMatch(verbs, /Call or WhatsApp/);
    assert.match(verbs, /export function inboxNeedsYouNextStep/);
  });

  it("names the human pile Return calls", () => {
    assert.match(niche, /id: "human", label: copy\.returnCtaMany/);
    assert.doesNotMatch(niche, /label: "Human"/);
  });

  it("puts Unknown caller in the name and the number only once", () => {
    const title = contacts.slice(
      contacts.indexOf("export function contactListTitle"),
      contacts.indexOf("export function contactListSubline")
    );
    const subline = contacts.slice(
      contacts.indexOf("export function contactListSubline"),
      contacts.indexOf("export function contactMatchesQuery")
    );
    assert.match(title, /return "Unknown caller"/);
    assert.doesNotMatch(title, /row\.phone/);
    assert.match(subline, /return phone \|\| "No phone"/);
    assert.match(contactRow, /whitespace-nowrap/);
    assert.match(contactRow, /lg:hidden/);
  });

  it("hides Catalog products on home services", () => {
    assert.match(form, /vertical === "home_services" \? null : \(/);
    assert.match(form, /settingsBlockTitleClass\}>Products/);
  });

  it("draws daily interactions with pixel bars", () => {
    assert.match(spark, /Daily interactions/);
    assert.match(spark, /height: `\$\{Math\.max\(2, Math\.round\(\(day\.count \/ max\) \* track\)\)\}px`/);
    assert.doesNotMatch(spark, /height: `\$\{Math\.max\(8/);
  });

  it("titles the two import routes differently", () => {
    assert.match(importPage, />\s*Import Contacts\s*</);
    assert.match(nav, /Import Catalog/);
    assert.match(nav, /Import Knowledge/);
    assert.match(shell, /settingsPanelHeading\(tab, trainPanel, tenant\.vertical\)/);
  });

  it("keeps a 44px checkbox hit and a larger touch box", () => {
    assert.match(check, /inline-flex h-11 w-11/);
    assert.match(check, /h-6 w-6/);
    assert.match(check, /lg:h-4 lg:w-4/);
    assert.match(board, /inline-flex h-11 w-11/);
    assert.match(board, /h-6 w-6/);
  });

  it("tightens desktop inbox and contacts cells without touching the phone row", () => {
    assert.match(table, /px-3 py-2 align-top/);
    assert.match(table, /px-4 py-3 first:border-t-0/);
    assert.doesNotMatch(table, /px-5 py-4/);
    assert.match(contactRow, /lg:px-3 lg:py-2/);
    assert.doesNotMatch(contactRow, /lg:px-5 lg:py-5/);
  });
});
