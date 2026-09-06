const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("work surface jobs", () => {
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const queues = read("dashboard/src/lib/deskWorkQueues.ts");
  const callsToolbar = read("dashboard/src/components/CallsCommandCenter.tsx");
  const requests = read("dashboard/src/app/(desk)/requests/page.tsx");
  const appointments = read("dashboard/src/app/(desk)/appointments/page.tsx");
  const visitToggle = read("dashboard/src/components/AppointmentStatusToggle.tsx");

  it("makes Overview a map of the three lists", () => {
    assert.match(home, /deskWorkQueues/);
    assert.match(home, /Needs you/);
    assert.match(queues, /label: "Calls"/);
    assert.match(queues, /label: "Requests"/);
    assert.match(queues, /label: "Appointments"/);
    assert.match(queues, /Open new calls/);
    assert.match(queues, /Fulfill requests/);
    assert.match(queues, /Confirm visits/);
    assert.doesNotMatch(home, /DeskDataTable/);
    assert.doesNotMatch(home, /TriageLeadCard/);
    assert.doesNotMatch(home, /\bOnline\b/);
  });

  it("keeps Calls as the voice inbox titled Calls", () => {
    assert.match(callsToolbar, /title="Calls"/);
    assert.doesNotMatch(callsToolbar, />Inbox</);
    assert.match(read("dashboard/src/app/(desk)/calls/page.tsx"), />\s*Open\s*</);
  });

  it("makes Requests fulfill and Appointments confirm", () => {
    assert.match(requests, />Item</);
    assert.match(requests, />Needed</);
    assert.match(requests, />\s*Call\s*</);
    assert.match(requests, /Nothing to fulfill/);
    assert.doesNotMatch(requests, /Filter by type/);
    assert.match(appointments, />Visit</);
    assert.match(appointments, />Place</);
    assert.match(appointments, /No visits to confirm/);
    assert.match(appointments, />\s*Call\s*</);
    assert.match(visitToggle, /Confirm/);
    assert.doesNotMatch(appointments, /tableHeadCellClass}>When</);
    assert.doesNotMatch(requests, /tableHeadCellClass}>When</);
  });
});
