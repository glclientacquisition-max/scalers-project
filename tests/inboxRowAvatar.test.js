const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox row avatar vs conversation hit", () => {
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const avatar = read("dashboard/src/components/InboxRowAvatar.tsx");
  const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");

  it("keeps the identity circle as a separate contact hit", () => {
    assert.match(avatar, /export function InboxRowAvatar/);
    assert.match(avatar, /aria-label=\{\`\$\{who\} profile\`\}/);
    assert.match(avatar, /ensureInboxContact/);
    assert.match(avatar, /No history yet/);
    assert.match(avatar, /DeskDialog/);
    assert.match(avatar, /createPortal/);
    assert.match(avatar, /Toggle selection/);
    assert.match(avatar, /itemId/);
  });

  it("opens a contact file when one exists, otherwise the stub", () => {
    assert.match(avatar, /if \(contactHref\)/);
    assert.match(inbox, /contactFromInboxHref/);
    assert.match(contact, /inboxFromContactHref/);
    assert.match(contact, /inboxBack \? "Inbox"/);
  });

  it("leaves the phone Conversation link wrapping name and preview only", () => {
    const phone = inbox.slice(inbox.indexOf("export function InboxPhoneRow"));
    const avatarAt = phone.indexOf("<InboxRowAvatar");
    const openAt = phone.indexOf("<InboxPhoneOpen");
    assert.ok(avatarAt > -1 && openAt > -1);
    assert.ok(avatarAt < openAt, "avatar sits before the Conversation open");
    assert.match(phone, /InboxTrailingAction/);
  });

  it("raises the table avatar above DeskRowHit", () => {
    assert.match(inbox, /deskRowActionClass/);
    assert.match(inbox, /<InboxRowHit href=\{openHref\} label="Conversation" itemId=\{item.id\} \/>/);
    const who = inbox.slice(inbox.indexOf("function InboxRowWho"), inbox.indexOf("function InboxTrailingAction"));
    assert.match(who, /deskRowActionClass/);
    assert.match(who, /InboxRowAvatar/);
  });
});
