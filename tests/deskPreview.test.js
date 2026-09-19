const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk preview truncate", () => {
  const chrome = read("dashboard/src/components/ui/deskChrome.ts");
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const purpose = read("dashboard/src/lib/inboxPurpose.ts");
  const mandate = read(".cursor/rules/scalers-design-ux.mdc");
  const constitution = read("docs/frontend/FRONTEND_CONSTITUTION.md");
  const master = read("docs/frontend/design-system/MASTER.md");
  const calls = read("docs/frontend/design-system/pages/calls.md");

  it("ships one preview class and a table cell that can ellipsize", () => {
    assert.match(chrome, /export const deskPreviewClass = "min-w-0 truncate"/);
    assert.match(chrome, /export const deskPreviewCellClass = "w-full max-w-0"/);
    assert.match(master, /deskPreviewClass/);
    assert.match(master, /deskPreviewCellClass/);
  });

  it("encodes WhatsApp-style list preview as law", () => {
    assert.match(mandate, /Preview truncate/);
    assert.match(mandate, /Identity plus one ellipsized line/);
    assert.match(constitution, /List preview is one truncated line/);
    assert.match(constitution, /WhatsApp, Instagram, Messenger, iOS Mail/);
    assert.match(calls, /Preview \(one line\)/);
    assert.match(calls, /never `line-clamp-2` for the summary/);
  });

  it("clamps Inbox Work to one line and drops mixed detail", () => {
    assert.match(inbox, /deskPreviewClass/);
    assert.match(inbox, /deskPreviewCellClass/);
    assert.doesNotMatch(inbox, /line-clamp-2/);
    assert.doesNotMatch(inbox, /item\.detail/);
    assert.doesNotMatch(inbox, /overflow-wrap:anywhere/);
  });

  it("keeps Home queue units as nouns, not hangup copy", () => {
    assert.match(purpose, /HOME_QUEUE_SAMPLE_MAX = 28/);
    assert.match(purpose, /text\.length <= HOME_QUEUE_SAMPLE_MAX/);
    assert.match(home, /nextHold\?\.hold\?\.when_text/);
    assert.match(home, /nextJob\?\.job\?\.when_text/);
    assert.doesNotMatch(home, /nextHold\?\.headline/);
    assert.doesNotMatch(home, /nextJob\?\.headline/);
    assert.match(home, /deskPreviewClass/);
    assert.doesNotMatch(home, /overflow-wrap:anywhere/);
  });

  it("clamps Contacts phone rows to name plus one preview", () => {
    const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
    const phone = contacts.slice(
      contacts.indexOf('className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface md:hidden"'),
      contacts.indexOf("hidden md:block")
    );
    assert.match(phone, /deskPreviewClass/);
    assert.match(phone, /lastReasonDisplay/);
    assert.match(phone, /formatCallWhenRelative/);
    assert.doesNotMatch(phone, /row\.phone/);
    assert.doesNotMatch(phone, /line-clamp-2/);
    assert.doesNotMatch(phone, /font-mono text-sm text-ink/);
  });

  it("clamps contact timeline What to one line and expands on tap", () => {
    const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    const what = read("dashboard/src/components/ContactTimelineWhat.tsx");
    assert.match(contact, /ContactTimelineWhat/);
    assert.match(what, /deskPreviewClass/);
    assert.match(what, /deskRowActionClass/);
    assert.match(what, /aria-expanded/);
    assert.match(what, /setOpen/);
    assert.doesNotMatch(what, /line-clamp-2/);
  });
});
