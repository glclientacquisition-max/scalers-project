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
    assert.match(avatar, /No history yet/);
    assert.match(avatar, /DeskDialog/);
    assert.match(avatar, /createPortal/);
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
    const linkAt = phone.indexOf('aria-label="Conversation"');
    const closeAvatar = phone.indexOf("/>", avatarAt);
    assert.ok(avatarAt > -1 && linkAt > -1 && closeAvatar > avatarAt);
    assert.ok(avatarAt < linkAt, "avatar sits before the Conversation link");
    assert.ok(closeAvatar < linkAt, "avatar is not inside the Conversation link");
    assert.match(phone, /InboxTrailingAction/);
  });

  it("raises the table avatar above DeskRowHit", () => {
    assert.match(inbox, /deskRowActionClass/);
    assert.match(inbox, /<DeskRowHit href=\{openHref\} label="Conversation" \/>/);
    const who = inbox.slice(inbox.indexOf("function InboxRowWho"), inbox.indexOf("function InboxTrailingAction"));
    assert.match(who, /deskRowActionClass/);
    assert.match(who, /InboxRowAvatar/);
  });
});
