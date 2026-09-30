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
    const list = inbox.slice(inbox.indexOf("function InboxListRow"));
    const avatarAt = list.indexOf("<InboxRowAvatar");
    const openAt = list.indexOf('ariaLabel="Conversation"');
    assert.ok(avatarAt > -1 && openAt > -1);
    assert.ok(avatarAt < openAt, "avatar sits before the Conversation open");
    assert.match(list, /InboxTrailingAction/);
  });

  it("keeps the avatar outside the conversation link", () => {
    assert.match(inbox, /ariaLabel="Conversation"/);
    const list = inbox.slice(inbox.indexOf("function InboxListRow"), inbox.indexOf("export function InboxPhoneRow"));
    assert.match(list, /aside=/);
    assert.match(list, /InboxRowAvatar/);
  });
});
