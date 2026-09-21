const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { mergeContactIdentity } = require("../src/conversation/contactIdentity");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const helperPath = path.join(__dirname, "../dashboard/src/lib/inboxHref.ts");

function loadInboxHrefs() {
  const script = `
    import { inboxThreadsFromContactHref, inboxReturnHref } from ${JSON.stringify(helperPath)};
    const cases = {
      phone: inboxThreadsFromContactHref("+254700000002"),
      spaced: inboxThreadsFromContactHref("  +254700000002  "),
      empty: inboxThreadsFromContactHref(""),
      missing: inboxThreadsFromContactHref(null),
      allSearch: inboxReturnHref({ purpose: "all", q: "+254700000002" }),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("contacts ops workflow ACCEPT", () => {
  const accept = read("docs/product/CONTACTS_OPS_WORKFLOW_ACCEPT.md");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const add = read("dashboard/src/components/AddContactPanel.tsx");
  const form = read("dashboard/src/components/ContactNameForm.tsx");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");
  const row = read("dashboard/src/components/ContactListRow.tsx");
  const hrefs = read("dashboard/src/lib/inboxHref.ts");
  const actions = read("dashboard/src/app/(desk)/contacts/actions.ts");
  const picker = read("dashboard/src/components/PhonebookImportButton.tsx");

  it("lands the ACCEPT spec without Funnel, Online, or delivery claims", () => {
    assert.match(accept, /One Add control/);
    assert.match(accept, /Rename when name already saved/);
    assert.match(accept, /Inbox threads/);
    assert.match(accept, /390 density/);
    assert.match(accept, /opened only/);
    assert.match(accept, /Phone stays locked/);
    assert.match(accept, /inboxThreadsFromContactHref/);
    assert.match(note, /one primary \*\*Add\*\*/);
    assert.match(note, /Inbox threads/);
    assert.match(note, /Phone stays locked/);
  });

  it("uses one Add control on the lead and hides the three separate CTAs", () => {
    assert.match(page, /<AddContactPanel/);
    assert.doesNotMatch(page, /Import CSV/);
    assert.doesNotMatch(page, /PhonebookImportButton/);
    assert.match(page, /flex-row items-center gap-2/);
    assert.match(add, /data-contact-add/);
    assert.match(add, />\s*Add\s*</);
    assert.match(add, />\s*New\s*</);
    assert.match(add, /href="\/contacts\/import"/);
    assert.match(add, />\s*CSV\s*</);
    assert.match(add, /From this phone/);
    assert.match(add, /pickerOn/);
    assert.match(add, /stashPhonebookCsv/);
    assert.match(add, /<DeskDialog/);
    assert.match(picker, /export async function stashPhonebookCsv/);
    assert.doesNotMatch(add, /[\u2014\u2013]/);
    assert.doesNotMatch(page, /[\u2014\u2013]/);
  });

  it("exposes Name edit on saved profiles and keeps Name this caller for junk", () => {
    assert.match(profile, /<ContactNameForm contactId=\{contact\.id\} initialName=\{contact\.name\} \/>/);
    assert.doesNotMatch(profile, /isJunkCallerName\(contact\.name\) \?/);
    assert.match(form, /junk \? "Name this caller" : "Name"/);
    assert.match(form, />\s*Save\s*</);
    assert.match(form, /updateContactName/);
    assert.match(form, /router\.refresh\(/);
    assert.doesNotMatch(form, /router\.push/);
    assert.doesNotMatch(form, /\bOnline\b/);
    assert.doesNotMatch(form, /[\u2014\u2013]/);
    const fn = actions.slice(actions.indexOf("export async function updateContactName"));
    assert.match(fn, /name: incoming/);
    assert.match(fn, /sanitizeStoredCallerName\(existing\.name\)/);
    const renamed = mergeContactIdentity({ name: "Otieno", metadata: {} }, { name: "Amina" });
    assert.equal(renamed.name, "Otieno");
  });

  it("links Inbox threads through existing search by phone and hides when there is no phone", () => {
    const hrefsLive = loadInboxHrefs();
    assert.equal(hrefsLive.phone, "/calls?purpose=all&q=%2B254700000002");
    assert.equal(hrefsLive.spaced, hrefsLive.phone);
    assert.equal(hrefsLive.empty, null);
    assert.equal(hrefsLive.missing, null);
    assert.equal(hrefsLive.allSearch, hrefsLive.phone);
    assert.match(hrefs, /export function inboxThreadsFromContactHref/);
    assert.match(hrefs, /purpose: "all"/);
    assert.match(profile, /inboxThreadsFromContactHref\(contact\.phone\)/);
    assert.match(profile, /Inbox threads/);
    assert.match(profile, /data-contact-inbox-threads/);
    assert.match(profile, /threadsHref \?/);
    assert.doesNotMatch(profile, /lead_status/);
    assert.doesNotMatch(profile, /Needs you/);
  });

  it("keeps Call and WhatsApp opened-only on the list, dock, and profile", () => {
    assert.match(row, /<CallLink number=\{number\} \/>/);
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.doesNotMatch(row, /callId=/);
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(row, /logWhatsAppFollowUp|lead_status|updateLeadStatus/);
    assert.doesNotMatch(dock, /logWhatsAppFollowUp|lead_status/);
    assert.doesNotMatch(profile, /lead_status|logWhatsAppFollowUp|Online|last seen/);
    assert.doesNotMatch(profile, /delivered|Delivered/);
    assert.doesNotMatch(page, /lead_status|Online/);
    assert.doesNotMatch(note, /[\u2014\u2013]/);
  });
});
