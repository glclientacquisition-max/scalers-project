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
    assert.match(back, /DeskHint label=\{children\}/);
    assert.match(back, /aria-label=\{children\}/);
    assert.match(back, /title=\{children\}/);
    assert.match(back, /min-h-11 min-w-11/);
    assert.match(back, /<BackChevron/);
    assert.match(back, /<svg viewBox="0 0 16 16"/);
    assert.doesNotMatch(back, />\{children\}</);
    assert.doesNotMatch(back, /hover:underline/);
    assert.doesNotMatch(back, /bg-accent-fill/);
    assert.match(back, /text-ink-soft/);
  });

  it("keeps ticket and archived href as deep links", () => {
    assert.match(detail, /inboxReturnHref\(inboxReturn\)/);
    assert.match(ticket, /<DeskBack href=\{backHref\}>Inbox<\/DeskBack>/);
    assert.match(toolbar, /<DeskBack href=\{backHref \|\| callsHref\(\{ q: q \|\| undefined \}\)\}>Inbox<\/DeskBack>/);
    assert.doesNotMatch(ticket, /href="\/calls"/);
    assert.doesNotMatch(ticket, /router\.push\("\/calls"\)/);
  });

  it("sits in the ticket header row instead of a text Inbox row", () => {
    const header = ticket.slice(ticket.indexOf("<header"), ticket.indexOf("</header>"));
    assert.match(header, /<DeskBack href=\{backHref\}>Inbox<\/DeskBack>/);
    assert.match(header, /flex items-center gap-1/);
    assert.doesNotMatch(header, /mt-2 flex items-center gap-2/);
    assert.doesNotMatch(ticket, />\s*Back to Inbox\s*</);
  });

  it("is the settings mobile back primitive", () => {
    assert.match(settings, /<DeskBack href="\/settings" className="mb-1 lg:hidden">/);
    assert.match(settings, />\s*Business Profile\s*</);
    assert.doesNotMatch(settings, /href="\/settings"[\s\S]{0,400}Business Profile\s*<\/Link>/);
  });
});
