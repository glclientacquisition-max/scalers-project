const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function loadHelpers() {
  const helperPath = path.join(__dirname, "../dashboard/src/lib/contactsLoad.ts");
  const script = `
    import {
      resolveContactSavedFilter,
      resolveContactSort,
      contactsHref,
      contactMatchesQuery,
      compareContactRows,
      uniqueRecentCallerPhones,
      rankContactByRecentPhones,
      paginateContactRows,
    } from ${JSON.stringify(helperPath)};
    const cases = {
      savedRecent: resolveContactSavedFilter("recent"),
      savedJunk: resolveContactSavedFilter("online"),
      sortName: resolveContactSort("name"),
      sortDefault: resolveContactSort(""),
      href: contactsHref({ saved: "unsaved", sort: "name", q: "Amina", page: 2 }),
      hrefBare: contactsHref({}),
      matchName: contactMatchesQuery({ name: "Amina", phone: "+254700000001" }, "ami"),
      missName: contactMatchesQuery({ name: "Otieno", phone: "+254700000002" }, "amina"),
      phones: uniqueRecentCallerPhones([
        { caller_number: "+254700000001" },
        { caller_number: "254700000001" },
        { caller_number: "+254700000003" },
      ]),
      rank: rankContactByRecentPhones("+254700000003", ["+254700000001", "+254700000003"]),
      page: paginateContactRows(["a", "b", "c"], 2, 2),
      nameOrder: ["Otieno", "Amina", "", "Brian"]
        .map((name, i) => ({
          name,
          lastContactAt: "2026-09-21T0" + i + ":00:00.000Z",
          updated_at: "2026-09-21T0" + i + ":00:00.000Z",
        }))
        .sort((a, b) => compareContactRows(a, b, "name"))
        .map((row) => row.name),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("contacts list Phase 1 helpers", () => {
  it("resolves search, sort, Recent calls, and Unsaved without inventing presence", () => {
    const cases = loadHelpers();
    assert.equal(cases.savedRecent, "recent");
    assert.equal(cases.savedJunk, "all");
    assert.equal(cases.sortName, "name");
    assert.equal(cases.sortDefault, "recent");
    assert.equal(cases.href, "/contacts?saved=unsaved&sort=name&q=Amina&page=2");
    assert.equal(cases.hrefBare, "/contacts");
    assert.equal(cases.matchName, true);
    assert.equal(cases.missName, false);
    assert.deepEqual(cases.phones, ["+254700000001", "+254700000003"]);
    assert.equal(cases.rank, 1);
    assert.deepEqual(cases.page, { rows: ["c"], total: 3 });
    assert.deepEqual(cases.nameOrder, ["Amina", "Brian", "Otieno", ""]);
  });
});

describe("contacts list Phase 1 chrome", () => {
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const row = read("dashboard/src/components/ContactListRow.tsx");
  const quick = read("dashboard/src/components/ContactQuickRow.tsx");
  const search = read("dashboard/src/components/ContactsSearch.tsx");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const accept = read("docs/product/CONTACTS_LIST_PHASE1_ACCEPT.md");
  const load = read("dashboard/src/lib/contactsLoad.ts");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");

  it("ships search and Recent / Name sort on the existing contacts list", () => {
    assert.match(page, /<ContactsSearch/);
    assert.match(search, /type="search"/);
    assert.match(search, /Name or number/);
    assert.match(page, /<FilterTabs/);
    assert.match(page, /label="Sort contacts"/);
    assert.match(page, /label: "Recent"/);
    assert.match(page, /label: "Name"/);
    assert.match(load, /resolveContactSort/);
    assert.match(note, /Search field/);
    assert.match(accept, /search \+ sort/);
  });

  it("puts Recent calls and Unsaved quick rows above the list, not Invite Friends", () => {
    assert.match(page, /<ContactQuickPhoneRow/);
    assert.match(page, /kind="recent"/);
    assert.match(page, /kind="unsaved"/);
    assert.match(quick, /Recent calls/);
    assert.match(quick, /Unsaved/);
    assert.doesNotMatch(page, /Invite Friends/);
    assert.doesNotMatch(quick, /Invite Friends/);
    assert.match(note, /Recent calls and Unsaved/);
    assert.doesNotMatch(note, /Invite Friends/);
  });

  it("keeps dense Call + WhatsApp as opened-only when a phone exists", () => {
    assert.match(row, /<CallLink number=\{phone\} \/>/);
    assert.match(row, /variant="icon"/);
    assert.doesNotMatch(row, /callId=/);
    assert.doesNotMatch(row, /logWhatsAppFollowUp/);
    assert.doesNotMatch(row, /lead_status/);
    assert.doesNotMatch(row, /updateLeadStatus/);
    assert.doesNotMatch(page, /lead_status/);
    assert.doesNotMatch(page, /logWhatsAppFollowUp/);
    const wa = row.slice(row.indexOf("<WhatsAppLink"));
    assert.doesNotMatch(wa.slice(0, 220), /message=/);
    assert.match(note, /opened only/);
  });

  it("does not invent Online, presence, live badges, or a contact activity strip", () => {
    assert.doesNotMatch(page, /\bOnline\b/);
    assert.doesNotMatch(row, /\bOnline\b/);
    assert.doesNotMatch(quick, /\bOnline\b/);
    assert.doesNotMatch(search, /\bOnline\b/);
    assert.doesNotMatch(page, /LivePing|RowStateDot|presence|activity strip/i);
    assert.doesNotMatch(row, /LivePing|RowStateDot|presence|activity strip/i);
    assert.doesNotMatch(quick, /LivePing|RowStateDot/);
    assert.match(note, /No Online/);
    assert.match(note, /Do not[\s\S]*ship a contact activity strip/);
    assert.match(accept, /Fake Online \/ presence/);
    assert.match(accept, /Contact activity strip/);
    assert.doesNotMatch(page, /ContactActivityStrip|activity strip/i);
  });

  it("keeps the profile dock and Name this caller on the existing write path", () => {
    assert.match(profile, /<ContactActionDock/);
    assert.match(profile, /<ContactNameForm/);
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(profile, /ContactActivityStrip/);
  });
});
