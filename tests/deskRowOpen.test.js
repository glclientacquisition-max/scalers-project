const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk rows open the record", () => {
  const hit = read("dashboard/src/components/ui/deskRowHit.tsx");
  const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const master = read("docs/frontend/design-system/MASTER.md");

  it("ships DeskRowHit as the shared list pattern", () => {
    assert.match(hit, /export function DeskRowHit/);
    assert.match(hit, /deskRowMutedClass/);
    assert.match(hit, /deskRowActionClass/);
    assert.match(master, /DeskRowHit/);
    assert.match(master, /No Call, Open, or View column/);
  });

  it("opens Inbox, Contacts, and Home from the row", () => {
    assert.match(inbox, /DeskRowHit/);
    assert.match(contacts, /DeskRowHit/);
    assert.match(home, /DeskRowHit/);
    assert.match(contact, /DeskRowHit/);
  });

  it("drops Open and Call list links", () => {
    assert.doesNotMatch(contacts, />\s*Open\s*</);
    assert.doesNotMatch(contact, />\s*Call\s*</);
    assert.doesNotMatch(home, /Open call/);
    assert.doesNotMatch(inbox, /item.hold \|\| item.job \? "Call" : "Open"/);
  });

  it("keeps internal metadata off the contact page", () => {
    assert.doesNotMatch(contact, /metaKeys/);
    assert.doesNotMatch(contact, /JSON\.stringify\(metadata/);
    assert.doesNotMatch(contact, />\s*Metadata\s*</);
  });
});
