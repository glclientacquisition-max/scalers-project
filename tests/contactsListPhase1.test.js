const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

/** Lockstep with dashboard/src/lib/contactsLoad.ts query helpers. */
function resolveContactSavedFilter(raw) {
  const value = String(raw || "all").toLowerCase();
  if (value === "saved" || value === "unsaved" || value === "recent") return value;
  return "all";
}

function resolveContactSort(raw) {
  return String(raw || "").toLowerCase() === "name" ? "name" : "recent";
}

function contactsHref(opts) {
  const q = new URLSearchParams();
  if (opts.saved && opts.saved !== "all") q.set("saved", opts.saved);
  if (opts.sort && opts.sort !== "recent") q.set("sort", opts.sort);
  const query = String(opts.q || "").trim();
  if (query) q.set("q", query);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const qs = q.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

function contactMatchesQuery(row, q) {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return true;
  const hay = [row.name, row.phone, row.lastReasonDisplay, row.last_reason]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(text);
}

function compareContactRows(a, b, sort) {
  if (sort === "name") {
    const an = String(a.name || "").trim().toLowerCase();
    const bn = String(b.name || "").trim().toLowerCase();
    if (!an && bn) return 1;
    if (an && !bn) return -1;
    const byName = an.localeCompare(bn, "en");
    if (byName) return byName;
  }
  const at = a.lastContactAt || a.updated_at || "";
  const bt = b.lastContactAt || b.updated_at || "";
  if (at === bt) return 0;
  return at < bt ? 1 : -1;
}

function contactListSubline(row) {
  if (!String(row.name || "").trim()) return "Unsaved";
  const phone = String(row.phone || "").trim();
  if (phone) return phone;
  return "";
}

function paginateContactRows(rows, page, pageSize) {
  const total = rows.length;
  const from = Math.max(0, (page - 1) * pageSize);
  return { rows: rows.slice(from, from + pageSize), total };
}

describe("contacts list Phase 1 helpers", () => {
  it("resolves search, sort, Recent calls, and Unsaved without inventing presence", () => {
    assert.equal(resolveContactSavedFilter("recent"), "recent");
    assert.equal(resolveContactSavedFilter("online"), "all");
    assert.equal(resolveContactSort("name"), "name");
    assert.equal(resolveContactSort(""), "recent");
    assert.equal(
      contactsHref({ saved: "unsaved", sort: "name", q: "Amina", page: 2 }),
      "/contacts?saved=unsaved&sort=name&q=Amina&page=2"
    );
    assert.equal(contactsHref({}), "/contacts");
    assert.equal(contactMatchesQuery({ name: "Amina", phone: "+254700000001" }, "ami"), true);
    assert.equal(contactMatchesQuery({ name: "Otieno", phone: "+254700000002" }, "amina"), false);
    assert.deepEqual(paginateContactRows(["a", "b", "c"], 2, 2), { rows: ["c"], total: 3 });
    assert.deepEqual(
      ["Otieno", "Amina", "", "Brian"]
        .map((name, i) => ({
          name,
          lastContactAt: `2026-09-21T0${i}:00:00.000Z`,
          updated_at: `2026-09-21T0${i}:00:00.000Z`,
        }))
        .sort((a, b) => compareContactRows(a, b, "name"))
        .map((row) => row.name),
      ["Amina", "Brian", "Otieno", ""]
    );
    assert.equal(contactListSubline({ name: null, phone: "+254700000001" }), "Unsaved");
    assert.equal(contactListSubline({ name: "Amina", phone: "+254700000002" }), "+254700000002");
    const src = read("dashboard/src/lib/contactsLoad.ts");
    assert.match(src, /export function contactListSubline/);
    assert.match(src, /return "Unsaved"/);
    assert.match(src, /formatCallWhenRelative\(row\.lastContactAt\)/);
    const sublineFn = src.slice(
      src.indexOf("export function contactListSubline"),
      src.indexOf("export function contactMatchesQuery")
    );
    assert.doesNotMatch(sublineFn, /lastReason|Online|last seen|active now/i);
    assert.match(src, /export function resolveContactSavedFilter/);
    assert.match(src, /value === "saved" \|\| value === "unsaved" \|\| value === "recent"/);
    assert.match(src, /export function resolveContactSort/);
    assert.match(src, /export function contactsHref/);
    assert.match(src, /export function contactMatchesQuery/);
    assert.match(src, /export function compareContactRows/);
    assert.match(src, /export function uniqueRecentCallerPhones/);
    assert.doesNotMatch(src, /\bOnline\b/);
  });
});

describe("contacts list Phase 1 chrome", () => {
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const row = read("dashboard/src/components/ContactListRow.tsx");
  const search = read("dashboard/src/components/ContactsSearch.tsx");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const accept = read("docs/product/CONTACTS_LIST_PHASE1_ACCEPT.md");
  const load = read("dashboard/src/lib/contactsLoad.ts");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");

  it("ships search and Last call / Name sort on the existing contacts list", () => {
    assert.match(page, /<ContactsSearch/);
    assert.match(search, /type="search"/);
    assert.match(search, /Name or number/);
    assert.match(page, /<FilterTabs/);
    assert.match(page, /label="Sort contacts"/);
    assert.match(page, /label: "Last call"/);
    assert.match(page, /label: "Name"/);
    assert.match(load, /resolveContactSort/);
    assert.match(note, /Search field/);
    assert.match(accept, /search \+ sort/);
  });

  it("keeps Recent and Unsaved as FilterTabs piles, not Invite Friends", () => {
    assert.match(page, /label: "Recent"/);
    assert.match(page, /label: "Unsaved"/);
    assert.doesNotMatch(page, /ContactQuickPhoneRow|ContactQuickTableRow/);
    assert.doesNotMatch(page, /Invite Friends/);
    assert.doesNotMatch(search, /Invite Friends/);
    assert.match(note, /All · Saved · Unsaved · Recent/);
    assert.match(accept, /FilterTabs items/);
  });

  it("keeps dense Call + WhatsApp as opened-only when a phone exists", () => {
    assert.match(row, /<CallLink number=\{number\} \/>/);
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
    assert.doesNotMatch(search, /\bOnline\b/);
    assert.doesNotMatch(page, /LivePing|RowStateDot|presence|activity strip/i);
    assert.doesNotMatch(row, /LivePing|RowStateDot|presence|activity strip/i);
    assert.match(note, /No Online/);
    assert.match(note, /Do not[\s\S]*ship a contact activity strip/);
    assert.match(accept, /Fake Online \/ presence/);
    assert.match(accept, /Contact activity strip/);
    assert.doesNotMatch(page, /ContactActivityStrip|activity strip/i);
    assert.doesNotMatch(page, /last seen|Last seen|active now|Active now/i);
    assert.doesNotMatch(row, /last seen|Last seen|active now|Active now/i);
    assert.doesNotMatch(row, /lastReasonDisplay/);
    assert.match(row, /contactListSubline/);
    assert.doesNotMatch(row, /delivered|Delivered/);
    assert.doesNotMatch(page, /delivered|Delivered/);
    assert.match(note, /Unsaved, phone, or last call/);
    assert.match(accept, /No Online, last seen/);
    assert.match(accept, /opened only/);
    assert.match(accept, /Contact activity strip is not in this PR/);
  });

  it("keeps the profile dock and Name this caller on the existing write path", () => {
    assert.match(profile, /<ContactActionDock/);
    assert.match(profile, /<ContactNameForm/);
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(profile, /ContactActivityStrip/);
  });
});
