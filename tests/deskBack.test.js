const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("DeskBack icon", () => {
  const back = read("dashboard/src/components/ui/DeskBack.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const settings = read("dashboard/src/components/settingsUi.tsx");

  it("renders a chevron without the visible word Inbox", () => {
    const icon = back.slice(
      back.indexOf("export function DeskBack"),
      back.indexOf("export function DeskRecordLead")
    );
    assert.match(icon, /DeskHint label=\{children\}/);
    assert.match(icon, /aria-label=\{children\}/);
    assert.match(icon, /title=\{children\}/);
    assert.match(icon, /min-h-11 min-w-11/);
    assert.match(icon, /<BackChevron/);
    assert.match(back, /<svg viewBox="0 0 16 16"/);
    assert.doesNotMatch(icon, />\{children\}</);
    assert.doesNotMatch(icon, /hover:underline/);
    assert.doesNotMatch(icon, /bg-accent-fill/);
    assert.match(icon, /text-ink-soft/);
  });

  it("keeps ticket and archived href as deep links", () => {
    assert.match(detail, /inboxReturnHref\(inboxReturn\)/);
    assert.match(ticket, /<DeskBack href=\{backHref\}>Inbox<\/DeskBack>/);
    assert.match(
      toolbar,
      /<DeskBack href=\{backHref \|\| callsHref\(\{ q: query \|\| undefined \}\)\}>Inbox<\/DeskBack>/
    );
    assert.doesNotMatch(ticket, /href="\/calls"/);
    assert.doesNotMatch(ticket, /router\.push\("\/calls"\)/);
  });

  it("sits in the ticket header row instead of a text Inbox row", () => {
    const header = ticket.slice(ticket.indexOf("<header"), ticket.indexOf("</header>"));
    assert.match(header, /<DeskBack href=\{backHref\}>Inbox<\/DeskBack>/);
    assert.match(header, /<DeskRecordLead/);
    assert.match(header, /align="center"/);
    assert.doesNotMatch(header, /mt-2 flex items-center gap-2/);
    assert.doesNotMatch(ticket, />\s*Back to Inbox\s*</);
  });

  it("is the settings mobile back primitive", () => {
    assert.match(settings, /<DeskBack href="\/settings" className="lg:hidden">/);
    assert.match(settings, /<DeskRecordLead/);
    assert.match(settings, />\s*Profile\s*</);
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
    assert.match(constitution, /Back never owns its own row/);
    assert.doesNotMatch(contact, /<DeskBack[\s\S]{0,80}<\/DeskBack>\s*<div className="mt-6 grid/);
    assert.doesNotMatch(imported, /<DeskBack[\s\S]{0,80}<\/DeskBack>\s*<h1 className="mt-4/);
  });
});
