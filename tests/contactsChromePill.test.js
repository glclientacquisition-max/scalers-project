const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("contacts chrome pill ACCEPT", () => {
  const accept = read("docs/product/CONTACTS_CHROME_PILL_ACCEPT.md");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const master = read("docs/frontend/design-system/MASTER.md");
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");
  const pills = read("dashboard/src/components/InboxFilterPills.tsx");
  const dev = read("dashboard/src/app/dev/contacts/page.tsx");
  const kpi = read("dashboard/src/lib/contactPersonFile.ts");
  const timeline = read("dashboard/src/components/ContactTimeline.tsx");

  it("lands the ACCEPT spec without Funnel, VIP, Online, or Inbox purpose nouns", () => {
    assert.match(accept, /All · Saved · Unsaved/);
    assert.match(accept, /InboxFilterPills/);
    assert.match(accept, /top Call and WhatsApp icons/);
    assert.match(accept, /opened only/i);
    assert.match(accept, /History and KPI/);
    assert.doesNotMatch(accept, /[\u2014\u2013]/);
    assert.doesNotMatch(note, /[\u2014\u2013]/);
    assert.match(note, /InboxFilterPills/);
    assert.match(note, /All · Saved · Unsaved/);
    assert.match(master, /Contacts segments/);
  });

  it("uses Inbox pill-chip DESIGN for All Saved Unsaved, not underline FilterTabs", () => {
    const purposeCall = page.match(/<InboxFilterPills[\s\S]*?\/>/);
    assert.ok(purposeCall, "Contacts segments are InboxFilterPills");
    assert.match(purposeCall[0], /label="Filter contacts"/);
    assert.match(purposeCall[0], /label: "All"/);
    assert.match(purposeCall[0], /label: "Saved"/);
    assert.match(purposeCall[0], /label: "Unsaved"/);
    assert.doesNotMatch(purposeCall[0], /label: "Needs you"/);
    assert.doesNotMatch(purposeCall[0], /label: "Visits"/);
    assert.doesNotMatch(purposeCall[0], /label: "Holds"/);
    assert.doesNotMatch(purposeCall[0], /label: "Human"/);
    assert.doesNotMatch(purposeCall[0], /label: "Answered"/);
    assert.doesNotMatch(purposeCall[0], /label: "VIP"/);
    assert.doesNotMatch(purposeCall[0], /label: "Cold"/);
    assert.doesNotMatch(page, /SEGMENT/);
    assert.match(pills, /rounded-full/);
    assert.match(pills, /bg-\[#005CCC\] text-white/);
    assert.match(pills, /item\.count/);
    assert.doesNotMatch(pills, /filterTabClass/);
    assert.match(dev, /<InboxFilterPills/);
    assert.doesNotMatch(dev, /label: "Needs you"|label: "Visits"|label: "Holds"/);
  });

  it("keeps Last call and Name as underline FilterTabs", () => {
    const sortCall = page.match(/<FilterTabs[\s\S]*?\/>/);
    assert.ok(sortCall, "sort stays FilterTabs");
    assert.match(sortCall[0], /label="Sort contacts"/);
    assert.match(sortCall[0], /label: "Last call"/);
    assert.match(sortCall[0], /label: "Name"/);
    assert.match(page, /active=\{sort\}/);
  });

  it("keeps one opened-only Call and WhatsApp pair as top icons on the person file", () => {
    assert.match(profile, /<ContactActionDock/);
    assert.match(profile, /number=\{contact\.phone\}/);
    assert.match(dock, /data-contact-action-dock/);
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.match(dock, /variant="icon"/);
    assert.doesNotMatch(dock, /flex w-16 flex-col items-center gap-1/);
    assert.doesNotMatch(dock, /<DockSlot/);
    assert.doesNotMatch(dock, /label="Call"/);
    assert.doesNotMatch(dock, /label="WhatsApp"/);
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(dock, /logWhatsAppFollowUp|lead_status|delivered|Delivered/);
    assert.doesNotMatch(profile, /logWhatsAppFollowUp|delivered|Delivered/);
    assert.match(dev, /<ContactActionDock/);
    const callCount = (profile.match(/<CallLink/g) || []).length;
    const waCount = (profile.match(/<WhatsAppLink/g) || []).length;
    assert.equal(callCount, 0, "person file uses the dock, not a second CallLink");
    assert.equal(waCount, 0, "person file uses the dock, not a second WhatsAppLink");
  });

  it("does not change #389 History or KPI honesty", () => {
    assert.match(profile, />History</);
    assert.match(profile, /<ContactTimeline entries=\{timeline\} \/>/);
    assert.match(profile, /<ContactKpiStrip cards=\{kpiCards\} \/>/);
    assert.match(kpi, /export function contactPersonFileKpiCards/);
    assert.match(kpi, /label: "Visits done"/);
    assert.match(kpi, /interactionCount > 0/);
    assert.match(timeline, /entry\.stamp/);
    assert.match(timeline, /entry\.href/);
    assert.doesNotMatch(timeline, /kindLabel|return "Request"|return "Call"/);
  });
});
