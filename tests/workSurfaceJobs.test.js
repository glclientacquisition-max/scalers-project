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

  it("keeps the four-item nav and Inbox redirects", () => {
    assert.match(nav, /label: "Overview"/);
    assert.match(nav, /label: "Inbox"/);
    assert.match(nav, /label: "Business"/);
    assert.match(nav, /label: "Wallet"/);
    assert.doesNotMatch(nav, /label: "Requests"/);
    assert.doesNotMatch(nav, /label: "Appointments"/);
    assert.match(requests, /\/calls\?purpose=hold/);
    assert.match(appointments, /\/calls\?purpose=job/);
  });

  it("makes Overview a map into Inbox purposes", () => {
    assert.match(home, /Needs you/);
    assert.match(home, /Holds/);
    assert.match(home, /Jobs/);
    assert.match(home, /homeBriefing/);
    assert.match(home, /Confirm visit/);
    assert.match(home, /Fulfill hold/);
    assert.match(home, /Return call/);
    assert.doesNotMatch(home, /Open inbox/);
    assert.doesNotMatch(home, /DeskDataTable/);
  });

  it("changes Holds and Jobs columns inside Inbox", () => {
    assert.match(toolbar, />\s*Inbox\s*</);
    assert.match(toolbar, /need you/);
    assert.match(toolbar, /caption/);
    assert.doesNotMatch(toolbar, /clamp\(2rem/);
    assert.match(inbox, /Nothing to fulfill/);
    assert.match(inbox, /No visits to confirm/);
    assert.match(inbox, />\s*Item\s*</);
    assert.match(inbox, />\s*Needed\s*</);
    assert.match(inbox, />\s*Visit\s*</);
    assert.match(inbox, />\s*Place\s*</);
    assert.match(inbox, /inboxCaption\(searched\)/);
    assert.match(inbox, /itemSignalLabel\(item\)/);
    assert.match(inbox, /formatCallWhenRelative/);
    assert.doesNotMatch(inbox, />\s*Purpose\s*</);
    assert.match(inbox, /openLabel = item.hold \|\| item.job \? "Call" : "Open"/);
  });
});
