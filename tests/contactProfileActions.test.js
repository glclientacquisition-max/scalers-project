const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mergeContactIdentity } = require("../src/conversation/contactIdentity");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("contact profile action dock", () => {
  const page = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");
  const ticketDock = read("dashboard/src/components/InboxTicketActionDock.tsx");
  const contactsNote = read("docs/frontend/design-system/pages/contacts.md");

  it("puts Call and WhatsApp on Saved and Unsaved profiles when a phone exists", () => {
    assert.match(page, /<ContactActionDock/);
    assert.match(page, /number=\{contact\.phone\}/);
    assert.match(dock, /data-contact-action-dock/);
    assert.match(dock, /aria-label="Contact actions"/);
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.match(dock, /variant="icon"/);
    assert.match(read("dashboard/src/components/CallLink.tsx"), /deskHitClass/);
    assert.match(read("dashboard/src/components/WhatsAppLink.tsx"), /deskHitClass/);
    assert.match(dock, /label="Call"/);
    assert.match(dock, /label="WhatsApp"/);
    assert.match(dock, /flex w-16 flex-col items-center gap-1/);
    assert.match(ticketDock, /flex w-16 flex-col items-center gap-1/);
    assert.match(contactsNote, /Call \+ WhatsApp/);
    assert.doesNotMatch(dock, /[\u2014\u2013]/);
    assert.doesNotMatch(page, /[\u2014\u2013]/);
  });

  it("uses wa.me only from a bare contact and does not write lead_status or notify", () => {
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(dock, /logWhatsAppFollowUp/);
    assert.doesNotMatch(dock, /updateLeadStatus/);
    assert.doesNotMatch(dock, /lead_status/);
    assert.doesNotMatch(dock, /notifyChannels/);
    assert.doesNotMatch(page, /callId=\{latestCall/);
    assert.doesNotMatch(page, /logWhatsAppFollowUp/);
    assert.doesNotMatch(page, /updateLeadStatus/);
    assert.doesNotMatch(page, /lead_status/);
    const wa = dock.slice(dock.indexOf("<WhatsAppLink"));
    assert.doesNotMatch(wa.slice(0, 280), /message=/);
  });
});

describe("contact profile Name this caller", () => {
  const page = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const form = read("dashboard/src/components/ContactNameForm.tsx");
  const actions = read("dashboard/src/app/(desk)/contacts/actions.ts");
  const sql = read("docs/supabase/contacts_and_requests.sql");

  it("offers Name this caller on unnamed profiles and stays on the file after Save", () => {
    assert.match(page, /<ContactNameForm contactId=\{contact\.id\} initialName=\{contact\.name\} \/>/);
    assert.match(form, /Name this caller/);
    assert.match(form, /junk \? "Name this caller" : "Name"/);
    assert.match(form, />\s*Save\s*</);
    assert.match(form, /updateContactName/);
    assert.match(form, /router\.refresh\(/);
    assert.match(form, /pendingSpinnerClass/);
    assert.match(form, /btnPrimary/);
    assert.doesNotMatch(form, /router\.push/);
    assert.doesNotMatch(form, /[\u2014\u2013]/);
  });

  it("saves the name through the existing contacts owner update path", () => {
    assert.match(sql, /grant update \(name, notes, last_reason, updated_at, metadata\)/);
    assert.match(sql, /contacts_update_member/);
    assert.match(actions, /export async function updateContactName/);
    assert.match(actions, /mergeContactIdentity/);
    const fn = actions.slice(actions.indexOf("export async function updateContactName"));
    assert.match(fn, /\.from\("contacts"\)/);
    assert.match(fn, /name: identity\.name/);
    assert.match(fn, /revalidatePath\(`\/contacts\/\$\{id\}`\)/);
    assert.doesNotMatch(fn, /createContact\(/);
    assert.doesNotMatch(fn, /upsertContact/);
    assert.doesNotMatch(fn, /lead_status/);
    assert.doesNotMatch(fn, /logWhatsAppFollowUp/);
  });

  it("promotes a junk or empty file name to the owner-entered name", () => {
    const healedUnknown = mergeContactIdentity(
      { name: "Unknown", metadata: {} },
      { name: "Amina" }
    );
    assert.equal(healedUnknown.name, "Amina");
    const healedEmpty = mergeContactIdentity(
      { name: null, metadata: {} },
      { name: "Otieno" }
    );
    assert.equal(healedEmpty.name, "Otieno");
  });
});
