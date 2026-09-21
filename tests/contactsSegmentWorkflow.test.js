const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

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

function contactProfileHref(id, opts = {}) {
  const q = new URLSearchParams();
  q.set("from", "contacts");
  if (opts.saved && opts.saved !== "all") q.set("saved", opts.saved);
  if (opts.sort && opts.sort !== "recent") q.set("sort", opts.sort);
  const query = String(opts.q || "").trim();
  if (query) q.set("q", query);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  return `/contacts/${id}?${q.toString()}`;
}

function contactsReturnHref(sp) {
  const from = String(sp.from || "contacts");
  if (from !== "contacts") return "/contacts";
  return contactsHref({
    saved: resolveContactSavedFilter(sp.saved),
    sort: resolveContactSort(sp.sort),
    q: sp.q,
    page: Math.max(1, Number.parseInt(String(sp.page || "1"), 10) || 1),
  });
}

describe("contacts segment workflow helpers", () => {
  it("keeps list segment, sort, search, and page on the profile and on Back", () => {
    assert.equal(contactProfileHref("ct-1"), "/contacts/ct-1?from=contacts");
    assert.equal(
      contactProfileHref("ct-2", {
        saved: "unsaved",
        sort: "name",
        q: "Amina",
        page: 2,
      }),
      "/contacts/ct-2?from=contacts&saved=unsaved&sort=name&q=Amina&page=2"
    );
    assert.equal(contactProfileHref("ct-3", { saved: "recent" }), "/contacts/ct-3?from=contacts&saved=recent");
    assert.equal(
      contactsReturnHref({
        from: "contacts",
        saved: "unsaved",
        sort: "name",
        q: "Amina",
        page: "2",
      }),
      "/contacts?saved=unsaved&sort=name&q=Amina&page=2"
    );
    assert.equal(contactsReturnHref({ from: "contacts" }), "/contacts");
    assert.equal(contactsReturnHref({ from: "inbox", saved: "unsaved" }), "/contacts");
    assert.equal(
      contactsHref({ saved: "unsaved", sort: "name", q: "Amina", page: 2 }),
      "/contacts?saved=unsaved&sort=name&q=Amina&page=2"
    );
    const src = read("dashboard/src/lib/contactsLoad.ts");
    assert.match(src, /export function contactProfileHref/);
    assert.match(src, /export function contactsReturnHref/);
    assert.match(src, /from", "contacts"/);
  });
});

describe("contacts segment FilterTabs chrome", () => {
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const tabs = read("dashboard/src/components/ui/FilterTabs.tsx");
  const chrome = read("dashboard/src/components/ui/deskChrome.ts");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const accept = read("docs/product/CONTACTS_SEGMENT_WORKFLOW_ACCEPT.md");
  const inboxTabs = read("dashboard/src/components/InboxToolbar.tsx");
  const row = read("dashboard/src/components/ContactListRow.tsx");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const load = read("dashboard/src/lib/contactsLoad.ts");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");
  const form = read("dashboard/src/components/ContactNameForm.tsx");
  const dev = read("dashboard/src/app/dev/contacts/page.tsx");

  it("lands the ACCEPT spec and uses shared FilterTabs, not a slider skin", () => {
    assert.match(accept, /All · Saved · Unsaved/);
    assert.match(accept, /Filter contacts/);
    assert.match(accept, /segment preserved/);
    assert.match(accept, /opened only/);
    assert.match(tabs, /filterTabClass/);
    assert.match(tabs, /filterTabCountClass/);
    assert.match(tabs, /overflow-x-auto/);
    assert.match(chrome, /export function filterTabClass/);
    assert.match(chrome, /min-h-11/);
    assert.match(inboxTabs, /<FilterTabs/);
    assert.match(page, /<FilterTabs/);
    assert.match(page, /label="Filter contacts"/);
    assert.doesNotMatch(page, /type="range"/);
    assert.doesNotMatch(page, /slider/i);
    assert.doesNotMatch(page, /InboxFilterPills/);
    assert.match(note, /Filter contacts/);
    assert.match(note, /FilterTabs/);
  });

  it("segments All, Saved, Unsaved, and Recent as FilterTabs items", () => {
    assert.match(page, /label: "All"/);
    assert.match(page, /label: "Saved"/);
    assert.match(page, /label: "Unsaved"/);
    assert.match(page, /label: "Recent"/);
    assert.match(page, /active=\{saved\}/);
    assert.match(page, /saved: "saved"/);
    assert.match(page, /saved: "unsaved"/);
    assert.match(page, /saved: "recent"/);
    assert.doesNotMatch(page, /ContactQuickPhoneRow|ContactQuickTableRow|ContactQuickRow/);
    assert.doesNotMatch(dev, /ContactQuickPhoneRow|ContactQuickTableRow/);
    assert.equal(
      fs.existsSync(path.join(__dirname, "../dashboard/src/components/ContactQuickRow.tsx")),
      false
    );
    assert.match(page, /label="Sort contacts"/);
    assert.match(page, /label: "Last call"/);
    assert.match(page, /label: "Name"/);
    assert.match(page, /active=\{sort\}/);
    assert.match(note, /All · Saved · Unsaved · Recent/);
    assert.match(note, /Last call/);
    assert.doesNotMatch(page, /Invite Friends/);
    assert.doesNotMatch(page, /[\u2014\u2013]/);
    assert.doesNotMatch(page, /\bOnline\b|last seen|Last seen|active now/i);
  });

  it("opens the profile from the row and Back restores the Contacts segment", () => {
    assert.match(row, /DeskRowHit href=\{href\}/);
    assert.match(page, /contactProfileHref/);
    assert.match(profile, /contactsReturnHref/);
    assert.match(load, /export function contactProfileHref/);
    assert.match(load, /export function contactsReturnHref/);
    assert.match(load, /from", "contacts"/);
    assert.match(profile, /saved\?: string/);
    assert.match(profile, /sort\?: string/);
    assert.match(note, /segment preserved/);
  });

  it("shows name or Name this caller, phone, last-call fact, and opened-only Call/WA", () => {
    assert.match(profile, /contactStripTitle/);
    assert.match(profile, /contactLastCallFact/);
    assert.match(profile, /<ContactActionDock/);
    assert.match(profile, /<ContactNameForm/);
    assert.match(form, /Name this caller/);
    assert.match(load, /export function contactLastCallFact/);
    assert.match(load, /Last call \$\{/);
    assert.doesNotMatch(load.slice(load.indexOf("export function contactLastCallFact")), /last seen/i);
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(dock, /logWhatsAppFollowUp/);
    assert.doesNotMatch(profile, /lead_status|Needs you|Online|last seen|Last seen/i);
    assert.doesNotMatch(profile, /delivered|Delivered/);
    assert.doesNotMatch(profile, /[\u2014\u2013]/);
    assert.match(note, /Name this caller/);
    assert.match(note, /last-call fact/);
    assert.match(accept, /No Online, last seen/);
  });
});
