const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("path");

const helperPath = path.join(__dirname, "../dashboard/src/lib/deskBackTarget.ts");

function load() {
  const script = `
    import { ticketDeskBack, contactDeskBack, callOpenedFromContactHref, contactBackLabel } from ${JSON.stringify(helperPath)};
    const cases = {
      home: ticketDeskBack({ from: "home", inboxHref: "/calls?purpose=needs" }),
      bare: ticketDeskBack({ inboxHref: "/calls" }),
      pile: ticketDeskBack({ from: "job", inboxHref: "/calls?purpose=job&view=today&day=2026-09-18" }),
      contacts: ticketDeskBack({ from: "contacts", inboxHref: "/calls" }),
      named: ticketDeskBack({ from: "contact", contactId: "ct-1", contactName: "Amina", inboxHref: "/calls" }),
      unnamed: ticketDeskBack({ from: "contact", contactId: "ct-2", contactName: "  ", inboxHref: "/calls" }),
      badId: ticketDeskBack({ from: "contact", contactId: "../x", contactName: "Amina", inboxHref: "/calls" }),
      fileHome: contactDeskBack({ from: "home", contactsHref: "/contacts?saved=saved" }),
      fileList: contactDeskBack({ from: "contacts", contactsHref: "/contacts?saved=unsaved&q=Amina" }),
      fileInbox: contactDeskBack({ from: "inbox", inboxHref: "/calls?purpose=needs", contactsHref: "/contacts" }),
      fileCall: contactDeskBack({ from: "call", callHref: "/calls/call-1?from=job", contactsHref: "/contacts" }),
      fileBare: contactDeskBack({ contactsHref: "/contacts" }),
      opened: callOpenedFromContactHref("call-1", "ct-1"),
      label: contactBackLabel("Amina"),
      emptyLabel: contactBackLabel(""),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("named desk back", () => {
  it("names the ticket parent from how the owner opened it", () => {
    const hrefs = load();
    assert.deepEqual(hrefs.home, { href: "/home", label: "Home" });
    assert.deepEqual(hrefs.bare, { href: "/calls", label: "Inbox" });
    assert.deepEqual(hrefs.pile, {
      href: "/calls?purpose=job&view=today&day=2026-09-18",
      label: "Inbox",
    });
    assert.deepEqual(hrefs.contacts, { href: "/contacts", label: "Contacts" });
    assert.deepEqual(hrefs.named, { href: "/contacts/ct-1", label: "Amina" });
    assert.deepEqual(hrefs.unnamed, { href: "/contacts/ct-2", label: "Contacts" });
    assert.deepEqual(hrefs.badId, { href: "/calls", label: "Inbox" });
    assert.equal(hrefs.opened, "/calls/call-1?from=contact&contact=ct-1");
    assert.equal(hrefs.label, "Amina");
    assert.equal(hrefs.emptyLabel, "Contacts");
  });

  it("names the contact file parent without the word Back", () => {
    const hrefs = load();
    assert.deepEqual(hrefs.fileHome, { href: "/home", label: "Home" });
    assert.deepEqual(hrefs.fileList, { href: "/contacts?saved=unsaved&q=Amina", label: "Contacts" });
    assert.deepEqual(hrefs.fileInbox, { href: "/calls?purpose=needs", label: "Inbox" });
    assert.deepEqual(hrefs.fileCall, { href: "/calls/call-1?from=job", label: "Inbox" });
    assert.deepEqual(hrefs.fileBare, { href: "/contacts", label: "Contacts" });
    for (const row of Object.values(hrefs)) {
      if (row && typeof row === "object" && "label" in row) {
        assert.notEqual(row.label, "Back");
      }
    }
  });
});
