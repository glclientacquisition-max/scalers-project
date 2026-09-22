const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function contactStripTitle(name, canName) {
  const cleaned = String(name || "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const junk = new Set([
    "calling",
    "caller",
    "customer",
    "unknown",
    "test",
    "n/a",
    "none",
  ]);
  const lower = cleaned.toLowerCase();
  const phoneLike = /^\+?[\d\s()-]+$/.test(cleaned);
  if (cleaned && !junk.has(lower) && !phoneLike) return cleaned;
  return canName ? "Name this caller" : "Unsaved";
}

function contactListSubline(row) {
  if (!String(row.name || "").trim()) return "Unsaved";
  const phone = String(row.phone || "").trim();
  if (phone) return phone;
  return row.lastContactAt ? "at 9:00 AM" : "No phone";
}

describe("contact strip copy", () => {
  it("uses a real name, or Unsaved / Name this caller, never a phone as the title", () => {
    assert.equal(contactStripTitle("Amina", true), "Amina");
    assert.equal(contactStripTitle("Unknown", true), "Name this caller");
    assert.equal(contactStripTitle("", true), "Name this caller");
    assert.equal(contactStripTitle("+254700000001", false), "Unsaved");
    assert.equal(contactStripTitle(null, false), "Unsaved");
  });

  it("keeps one Phase 1 fact: Unsaved, phone, or last call", () => {
    assert.equal(contactListSubline({ name: null, phone: "+254700000001" }), "Unsaved");
    assert.equal(
      contactListSubline({ name: "Amina", phone: "+254700000002" }),
      "+254700000002"
    );
    assert.equal(
      contactListSubline({
        name: "Amina",
        phone: null,
        lastContactAt: "2026-09-21T06:00:00.000Z",
      }),
      "at 9:00 AM"
    );
    const src = read("dashboard/src/lib/contactStrip.ts");
    assert.match(src, /export function contactStripTitle/);
    assert.match(src, /sanitizeStoredCallerName/);
    assert.match(src, /Name this caller/);
    assert.match(src, /Unsaved/);
    assert.match(src, /contactListSubline/);
    assert.match(src, /CONTACT_STRIP_FACTS/);
    assert.match(src, /CONTACT_STRIP_REACH = "opened"/);
    assert.match(src, /CONTACT_STRIP_CRITIC_BANS/);
    const facts = src.slice(
      src.indexOf("export const CONTACT_STRIP_FACTS"),
      src.indexOf("export type ContactStripFact")
    );
    assert.match(facts, /Unsaved/);
    assert.match(facts, /phone/);
    assert.match(facts, /lastCall/);
    assert.match(facts, /opened/);
    assert.doesNotMatch(facts, /delivered|sent|Online|Needs you/);
  });
});

describe("contact strip chrome", () => {
  const strip = read("dashboard/src/components/ContactStrip.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const form = read("dashboard/src/components/ContactNameForm.tsx");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const list = read("dashboard/src/components/ContactListRow.tsx");
  const note = read("docs/frontend/design-system/pages/call-detail.md");
  const contactsNote = read("docs/frontend/design-system/pages/contacts.md");
  const accept = read("docs/product/CONTACT_STRIP_ACCEPT.md");
  const master = read("docs/frontend/design-system/MASTER.md");

  it("lands the ACCEPT spec and one composition family on the ticket", () => {
    assert.match(accept, /\*\*Status:\*\* ACCEPT/);
    assert.match(accept, /factual subline only/);
    assert.match(accept, /Strip is identity/);
    assert.match(ticket, /<ContactStrip/);
    assert.match(ticket, /profileHref=\{contactHref\}/);
    assert.match(detail, /lastContactAt=/);
    assert.match(note, /ContactStrip/);
    assert.match(master, /Contact strip/);
    assert.match(contactsNote, /ContactStrip/);
    assert.doesNotMatch(strip, /md:hidden|hidden md:|lg:hidden|hidden lg:/);
  });

  it("matches Phase 1 list density: avatar, one preview, identity only", () => {
    assert.match(strip, /data-contact-strip/);
    assert.match(strip, /RowIdentity/);
    assert.match(strip, /contactStripTitle/);
    assert.match(strip, /contactListSubline/);
    assert.match(strip, /deskPreviewClass/);
    assert.doesNotMatch(strip, /CallLink/);
    assert.doesNotMatch(strip, /WhatsAppLink/);
    assert.doesNotMatch(strip, /deskRowActionClass/);
    assert.doesNotMatch(strip, /data-contact-strip-reach/);
    assert.match(strip, /DeskRowHit/);
    assert.doesNotMatch(strip, /callId=/);
    assert.doesNotMatch(strip, /logWhatsAppFollowUp/);
    assert.doesNotMatch(strip, /lead_status/);
    assert.doesNotMatch(strip, /updateLeadStatus/);
    assert.doesNotMatch(strip, /\bOnline\b/);
    assert.doesNotMatch(strip, /last seen|Last seen|active now|Active now/i);
    assert.doesNotMatch(strip, /delivered|Delivered|LivePing|RowStateDot/);
    assert.doesNotMatch(strip, /[\u2014\u2013]/);
    assert.match(list, /contactListSubline/);
    assert.match(list, /<CallLink number=\{number\} \/>/);
  });

  it("taps identity into the existing profile and leaves Name this caller on that file", () => {
    assert.match(strip, /DeskRowHit href=\{profileHref\}/);
    assert.match(detail, /contactFromCallHref/);
    assert.match(form, /Name this caller/);
    assert.match(form, /updateContactName/);
    assert.match(profile, /<ContactNameForm contactId=\{contact.id\} initialName=\{contact.name\} \/>/);
    assert.doesNotMatch(strip, /<ContactNameForm/);
    assert.doesNotMatch(ticket, /<ContactNameForm/);
    assert.doesNotMatch(strip, /createContact|upsertContact/);
  });

  it("does not invent ticket write-back or a second list language", () => {
    assert.doesNotMatch(strip, /notifyChannels/);
    assert.doesNotMatch(ticket, /<CallLink number=\{callerPhone\} \/>/);
    assert.doesNotMatch(ticket, /<WhatsAppLink/);
    const actionDock = read("dashboard/src/components/InboxTicketActionDock.tsx");
    assert.match(actionDock, /<CallLink number=\{callerPhone\} \/>/);
    assert.match(actionDock, /<WhatsAppLink/);
    assert.match(actionDock, /callId=\{callId\}/);
    assert.match(note, /No Call or WhatsApp in the strip/);
    assert.match(accept, /Strip does not duplicate them/);
    assert.match(accept, /No Online, last seen/);
    assert.match(accept, /Contacts list Phase 1 redo/);
    assert.doesNotMatch(list, /ContactStrip/);
  });

  it("binds Critic hard bans on the strip", () => {
    const src = read("dashboard/src/lib/contactStrip.ts");
    assert.match(src, /"Online"/);
    assert.match(src, /"last seen"/);
    assert.match(src, /"presence"/);
    assert.match(src, /"active now"/);
    assert.match(src, /"delivered"/);
    assert.match(src, /"sent"/);
    assert.match(src, /"lead_status"/);
    assert.match(src, /"Needs you"/);
    assert.match(src, /"Meta"/);
    assert.match(src, /CONTACT_STRIP_REACH = "opened"/);
    assert.doesNotMatch(strip, /data-contact-strip-reach/);
    assert.doesNotMatch(strip, /CallLink|WhatsAppLink/);
    assert.doesNotMatch(strip, /\bOnline\b/);
    assert.doesNotMatch(strip, /last seen|Last seen|active now|Active now/i);
    assert.doesNotMatch(strip, /presence|LivePing|RowStateDot/);
    assert.doesNotMatch(strip, /delivered|Delivered|\bsent\b/);
    assert.doesNotMatch(strip, /lead_status|Needs you|notifyChannels/);
    assert.doesNotMatch(strip, /Meta|blue tick|lastSeen|typing/i);
    assert.doesNotMatch(ticket, /data-contact-strip-reach/);
    assert.match(accept, /Critic PASS \(hard bans\)/);
    assert.match(accept, /Strip does not duplicate them/);
    assert.match(accept, /No inventing `lead_status` or Needs you/);
    assert.match(accept, /No Meta activity theater/);
    assert.match(accept, /Call \/ WhatsApp live on the ticket dock/);
    assert.match(accept, /One family at ~390/);
    assert.match(note, /No Call or WhatsApp in the strip/);
    assert.match(note, /Never delivered or sent without channel evidence/);
    assert.match(master, /Identity only/);
    assert.match(master, /Call \+ WhatsApp live on the ticket Action dock/);
    assert.doesNotMatch(master, /data-contact-strip-reach="opened"/);
    assert.match(contactsNote, /Identity only/);
    assert.match(read("docs/product/DELIVERY_VOCAB.md"), /\*\*opened\*\*/);
  });
});
