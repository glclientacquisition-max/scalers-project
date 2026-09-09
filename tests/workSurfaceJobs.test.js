const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("work surface jobs on unified inbox", () => {
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const inbox = read("dashboard/src/app/(desk)/calls/page.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const requests = read("dashboard/src/app/(desk)/requests/page.tsx");
  const appointments = read("dashboard/src/app/(desk)/appointments/page.tsx");

  it("keeps Overview Inbox Contacts Business Wallet and Inbox redirects", () => {
    assert.match(nav, /label: "Overview"/);
    assert.match(nav, /label: "Inbox"/);
    assert.match(nav, /label: "Contacts"/);
    assert.match(nav, /label: "Business"/);
    assert.match(nav, /label: "Wallet"/);
    assert.doesNotMatch(nav, /label: "Requests"/);
    assert.doesNotMatch(nav, /label: "Appointments"/);
    assert.match(requests, /\/calls\?purpose=hold/);
    assert.match(appointments, /\/calls\?purpose=job/);
  });

  it("makes Overview a map into Inbox purposes", () => {
    assert.match(home, /Needs you/);
    assert.match(home, /copy.holdFilter/);
    assert.match(home, /copy.jobFilter/);
    assert.match(home, /homeBriefing/);
    assert.match(home, /summarizeInboxWork/);
    assert.match(home, /purpose: "human"/);
    assert.match(home, /purpose: "hold"/);
    assert.match(home, /purpose: "job"/);
    assert.doesNotMatch(home, /Open inbox/);
    assert.doesNotMatch(home, /DeskDataTable/);
  });

  it("changes Holds and Jobs columns inside Inbox", () => {
    const niche = read("dashboard/src/lib/inboxNiche.ts");
    assert.match(toolbar, />\s*Inbox\s*</);
    assert.match(toolbar, /need you/);
    assert.match(toolbar, /caption/);
    assert.match(toolbar, /purposeFilters/);
    assert.doesNotMatch(toolbar, /clamp\(2rem/);
    assert.match(niche, /holdEmpty: "Nothing to fulfill"/);
    assert.match(niche, /jobEmpty: "No visits to confirm"/);
    assert.match(niche, /jobFilter: "Visits"/);
    assert.match(niche, /jobFilter: "Bookings"/);
    assert.match(niche, /pickupStamp: "Pickup"/);
    assert.match(inbox, />\s*Item\s*</);
    assert.match(inbox, />\s*Needed\s*</);
    assert.match(inbox, /copy.jobColumn/);
    assert.match(inbox, />\s*Place\s*</);
    assert.match(inbox, /inboxCaption\(searched, vertical\)/);
    assert.match(inbox, /itemSignalLabel\(item, vertical\)/);
    assert.match(inbox, /formatCallWhenRelative/);
    assert.doesNotMatch(inbox, />\s*Purpose\s*</);
    assert.match(inbox, /openLabel = item.hold \|\| item.job \? "Call" : "Open"/);
    const load = read("dashboard/src/lib/inboxLoad.ts");
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    assert.match(inbox, /\/contacts\/\$\{item.contactId\}/);
    assert.match(load, /attachContactIds/);
    assert.match(purpose, /compareInboxSignal/);
  });
});
