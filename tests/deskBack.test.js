const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("DeskBack icon", () => {
  const back = read("dashboard/src/components/ui/DeskBack.tsx");
  const header = read("dashboard/src/components/ui/PageHeader.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const settings = read("dashboard/src/components/settingsUi.tsx");
  const icon = read("dashboard/src/components/ui/IconButton.tsx");

  it("renders a chevron without the visible word Inbox", () => {
    const fn = back.slice(
      back.indexOf("export function DeskBack"),
      back.indexOf("export function DeskRecordLead")
    );
    assert.match(fn, /IconButtonLink href=\{href\} label=\{children\}/);
    assert.match(fn, /ChevronLeftIcon/);
    assert.match(fn, /data-desk-back=""/);
    assert.doesNotMatch(fn, />\{children\}</);
    assert.doesNotMatch(fn, /hover:underline/);
    assert.doesNotMatch(fn, /bg-accent-fill/);
    assert.doesNotMatch(fn, /<svg viewBox="0 0 16 16"/);
    assert.doesNotMatch(fn, /DeskHint/);
    assert.match(icon, /rounded-full/);
    assert.match(icon, /h-11 w-11/);
    assert.match(icon, /focus-visible:ring-brand/);
  });

  it("shares the same Back disc on PageHeader", () => {
    assert.match(header, /IconButtonLink href=\{back\.href\} label=\{back\.label\}/);
    assert.match(header, /ChevronLeftIcon/);
    assert.match(header, /data-desk-back=""/);
  });

  it("keeps ticket and archived href as deep links", () => {
    assert.match(detail, /inboxReturnHref\(inboxReturn\)/);
    assert.match(ticket, /<DeskBack href=\{backHref\}>\{backHref === "\/home" \? "Home" : "Inbox"\}<\/DeskBack>/);
    assert.match(
      toolbar,
      /<DeskBack href=\{backHref \|\| callsHref\(\{ q: query \|\| undefined \}\)\}>Inbox<\/DeskBack>/
    );
    assert.doesNotMatch(ticket, /href="\/calls"/);
    assert.doesNotMatch(ticket, /router\.push\("\/calls"\)/);
  });

  it("sits in the ticket header row instead of a text Inbox row", () => {
    const ticketHeader = ticket.slice(ticket.indexOf("<header"), ticket.indexOf("</header>"));
    assert.match(ticketHeader, /DeskBack href=\{backHref\}/);
    assert.match(ticketHeader, /"Home" : "Inbox"/);
    assert.match(ticketHeader, /<DeskRecordLead/);
    assert.match(ticketHeader, /align="center"/);
    assert.doesNotMatch(ticketHeader, /mt-2 flex items-center gap-2/);
    assert.doesNotMatch(ticket, />\s*Back to Inbox\s*</);
  });

  it("is the settings mobile back primitive", () => {
    assert.match(settings, /<DeskBack href="\/settings" className="md:hidden">/);
    assert.match(settings, /<DeskRecordLead/);
    assert.match(settings, />\s*Settings\s*</);
    assert.doesNotMatch(settings, />\s*Profile\s*</);
    assert.doesNotMatch(settings, /className="mb-1 lg:hidden"/);
    assert.doesNotMatch(settings, /href="\/settings"[\s\S]{0,400}Profile\s*<\/Link>/);
  });

  it("never gives Back its own row on nested records", () => {
    const lead = read("dashboard/src/components/ui/DeskBack.tsx");
    const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    const imported = read("dashboard/src/app/(desk)/contacts/import/page.tsx");
    const constitution = read("docs/frontend/FRONTEND_CONSTITUTION.md");
    assert.match(lead, /export function DeskRecordLead/);
    assert.match(lead, /data-desk-record-lead/);
    assert.match(contact, /<DeskRecordLead/);
    assert.match(imported, /<DeskRecordLead/);
    assert.match(toolbar, /<DeskRecordLead/);
    assert.match(read("dashboard/src/components/AdminNav.tsx"), /<DeskBack href=\{parent\.href\}>/);
    assert.match(constitution, /Back never owns its own row/);
    assert.doesNotMatch(contact, /<DeskBack[\s\S]{0,80}<\/DeskBack>\s*<div className="mt-6 grid/);
    assert.doesNotMatch(imported, /<DeskBack[\s\S]{0,80}<\/DeskBack>\s*<h1 className="mt-4/);
  });
});
