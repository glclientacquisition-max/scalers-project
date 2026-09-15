const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("MVP owner workflow clarity", () => {
  it("refreshes call detail after Confirm or Done", () => {
    const appointments = read("dashboard/src/app/(desk)/appointments/actions.ts");
    const requests = read("dashboard/src/app/(desk)/requests/actions.ts");
    assert.match(appointments, /select\("caller_phone, caller_name, service_name, when_text, call_id"\)/);
    assert.match(appointments, /if \(row\?\.call_id\) revalidatePath\(`\/calls\/\$\{row\.call_id\}`\)/);
    assert.match(requests, /select\("call_id"\)/);
    assert.match(requests, /if \(row\?\.call_id\) revalidatePath\(`\/calls\/\$\{row\.call_id\}`\)/);
  });

  it("names requested work on call detail without brain intent ids", () => {
    const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    assert.match(detail, /holdHeadline/);
    assert.match(detail, /holdTypeLabel/);
    assert.match(detail, /visitStamp/);
    assert.match(detail, /job\.service_name/);
    assert.doesNotMatch(detail, /row\.primary_intent \?/);
    assert.doesNotMatch(detail, /· \{row\.primary_intent\}/);
    assert.doesNotMatch(detail, />\s*Hold\s*</);
    assert.doesNotMatch(detail, />\s*Visit\s*</);
  });

  it("does not use brain intent ids as contact timeline headlines", () => {
    const contacts = read("dashboard/src/lib/contactsLoad.ts");
    assert.doesNotMatch(contacts, /row\.primary_intent \|\|/);
    assert.match(contacts, /ownerReason \|\|\s*"Call"/);
  });
});
