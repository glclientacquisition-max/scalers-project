const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const helperPath = path.join(__dirname, "../dashboard/src/lib/inboxHref.ts");

function load() {
  const script = `
    import {
      inboxRecordHref,
      inboxReturnHref,
      contactFromCallHref,
      callFromContactHref,
      contactFromInboxHref,
      inboxFromContactHref,
    } from ${JSON.stringify(helperPath)};
    const cases = {
      today: inboxRecordHref("call-1", { purpose: "job", view: "today", day: "2026-09-18" }),
      holdToday: inboxRecordHref("call-3", { purpose: "hold", view: "today", day: "2026-09-18" }),
      backHoldToday: inboxReturnHref({ from: "hold", view: "today", day: "2026-09-18" }),
      searchPage: inboxRecordHref("call-2", { purpose: "needs", q: "Amina", page: 2 }),
      backToday: inboxReturnHref({ from: "job", view: "today", day: "2026-09-18" }),
      backSearch: inboxReturnHref({ from: "needs", q: "Amina", page: "2" }),
      bare: inboxReturnHref({}),
      contact: contactFromCallHref("ct-1", "call-1", { purpose: "job", view: "today", day: "2026-09-18" }),
      fromContact: callFromContactHref({
        from: "call",
        call: "call-1",
        purpose: "job",
        view: "today",
        day: "2026-09-18",
      }),
      contactsList: callFromContactHref({ from: "contacts" }),
      inboxContact: contactFromInboxHref("ct-1", { purpose: "needs", q: "Amina", page: 2 }),
      fromInbox: inboxFromContactHref({
        from: "inbox",
        purpose: "needs",
        q: "Amina",
        page: "2",
      }),
      inboxBare: inboxFromContactHref({ from: "inbox" }),
      notInbox: inboxFromContactHref({ from: "call", call: "call-1" }),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("inbox return path", () => {
  it("opens the call with the list pile, visit layout, search, and page", () => {
    const hrefs = load();
    assert.equal(hrefs.today, "/calls/call-1?from=job&view=today&day=2026-09-18");
    assert.equal(hrefs.holdToday, "/calls/call-3?from=hold&view=today&day=2026-09-18");
    assert.equal(hrefs.searchPage, "/calls/call-2?from=needs&q=Amina&page=2");
  });

  it("returns Inbox to that same pile and layout", () => {
    const hrefs = load();
    assert.equal(hrefs.backToday, "/calls?purpose=job&view=today&day=2026-09-18");
    assert.equal(hrefs.backHoldToday, "/calls?purpose=hold&view=today&day=2026-09-18");
    assert.equal(hrefs.backSearch, "/calls?purpose=needs&q=Amina&page=2");
    assert.equal(hrefs.bare, "/calls");
  });

  it("returns a contact opened from a call back to that call", () => {
    const hrefs = load();
    assert.equal(
      hrefs.contact,
      "/contacts/ct-1?from=call&call=call-1&purpose=job&view=today&day=2026-09-18"
    );
    assert.equal(hrefs.fromContact, "/calls/call-1?from=job&view=today&day=2026-09-18");
    assert.equal(hrefs.contactsList, null);
  });

  it("returns a contact opened from Inbox back to that pile", () => {
    const hrefs = load();
    assert.equal(hrefs.inboxContact, "/contacts/ct-1?purpose=needs&q=Amina&page=2&from=inbox");
    assert.equal(hrefs.fromInbox, "/calls?purpose=needs&q=Amina&page=2");
    assert.equal(hrefs.inboxBare, "/calls");
    assert.equal(hrefs.notInbox, null);
  });
});
