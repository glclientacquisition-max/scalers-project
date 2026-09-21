const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function nairobiYearMonth(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
  };
}

function pickFirstSeenAt(...stamps) {
  let earliest = null;
  for (const stamp of stamps) {
    const iso = String(stamp || "").trim();
    if (!iso) continue;
    if (!Number.isFinite(Date.parse(iso))) continue;
    if (!earliest || iso < earliest) earliest = iso;
  }
  return earliest;
}

function customerSinceMonths(iso, now = new Date()) {
  const raw = String(iso || "").trim();
  if (!raw) return null;
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return null;
  const a = nairobiYearMonth(then);
  const b = nairobiYearMonth(now);
  if (!a.year || !a.month || !b.year || !b.month) return null;
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  return months < 0 ? 0 : months;
}

function contactPersonFileKpiCards(opts) {
  const cards = [];
  if (opts.interactionCount > 0) {
    cards.push({
      id: "interactions",
      label: "Interactions",
      value: String(opts.interactionCount),
    });
  }
  if (opts.visitsDoneCount > 0) {
    cards.push({
      id: "visitsDone",
      label: "Visits done",
      value: String(opts.visitsDoneCount),
    });
  }
  const months = customerSinceMonths(opts.firstSeenAt, opts.now);
  if (months != null) {
    cards.push({
      id: "customerSince",
      label: "Customer since",
      value: `${months} mo`,
    });
  }
  return cards;
}

describe("contacts person-file KPI lock", () => {
  it("derives Interactions, Visits done, and Customer since without wallpaper", () => {
    const now = new Date("2026-09-21T08:00:00+03:00");
    assert.equal(
      pickFirstSeenAt("2026-09-20T10:00:00.000Z", "2026-01-21T07:00:00.000Z"),
      "2026-01-21T07:00:00.000Z"
    );
    assert.equal(customerSinceMonths("2026-01-21T07:00:00+03:00", now), 8);
    assert.equal(customerSinceMonths("2026-09-21T07:00:00+03:00", now), 0);
    assert.equal(customerSinceMonths(null, now), null);
    assert.deepEqual(
      contactPersonFileKpiCards({
        interactionCount: 3,
        visitsDoneCount: 2,
        firstSeenAt: "2026-01-21T07:00:00+03:00",
        now,
      }),
      [
        { id: "interactions", label: "Interactions", value: "3" },
        { id: "visitsDone", label: "Visits done", value: "2" },
        { id: "customerSince", label: "Customer since", value: "8 mo" },
      ]
    );
    assert.deepEqual(
      contactPersonFileKpiCards({
        interactionCount: 0,
        visitsDoneCount: 0,
        firstSeenAt: null,
        now,
      }),
      []
    );
    const src = read("dashboard/src/lib/contactPersonFile.ts");
    assert.match(src, /export function pickFirstSeenAt/);
    assert.match(src, /export function customerSinceMonths/);
    assert.match(src, /export function contactPersonFileKpiCards/);
    assert.match(src, /id: "interactions"/);
    assert.match(src, /label: "Visits done"/);
    assert.match(src, /interactionCount > 0/);
    assert.match(src, /visitsDoneCount > 0/);
    assert.doesNotMatch(src, /\bOnline\b/);
    assert.doesNotMatch(src, /last seen/);
    assert.doesNotMatch(src, /\bVIP\b/);
    assert.doesNotMatch(src, /\bCold\b/);
  });
});

describe("contacts person-file History lock", () => {
  it("merges a call plus its job into one Inbox-stamped History row", () => {
    const src = read("dashboard/src/lib/contactPersonFile.ts");
    const load = read("dashboard/src/lib/contactsLoad.ts");
    const timeline = read("dashboard/src/components/ContactTimeline.tsx");
    assert.match(src, /holdByCall\.get\(lead\.call\.id\)/);
    assert.match(src, /jobByCall\.get\(lead\.call\.id\)/);
    assert.match(src, /buildInboxItem/);
    assert.match(src, /itemSignalLabel/);
    assert.match(src, /inboxRecordHref\(item\.callId\)/);
    assert.match(src, /jobStatus: item\.job\?\.status/);
    assert.match(src, /items\.sort/);
    assert.match(load, /contactHistoryEntries/);
    assert.match(load, /toLead/);
    assert.doesNotMatch(src, /return "Request"|return "Call"/);
    assert.doesNotMatch(timeline, /kindLabel|return "Request"|return "Call"/);
    assert.match(timeline, /entry\.stamp/);
    assert.match(timeline, /entry\.href/);
  });
});

describe("contacts person-file chrome", () => {
  const accept = read("docs/product/CONTACTS_PERSON_FILE_ACCEPT.md");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const timeline = read("dashboard/src/components/ContactTimeline.tsx");
  const strip = read("dashboard/src/components/ContactKpiStrip.tsx");
  const load = read("dashboard/src/lib/contactsLoad.ts");
  const helpers = read("dashboard/src/lib/contactPersonFile.ts");
  const dock = read("dashboard/src/components/ContactActionDock.tsx");
  const row = read("dashboard/src/components/ContactListRow.tsx");
  const dev = read("dashboard/src/app/dev/contacts/page.tsx");

  it("lands the ACCEPT spec without Funnel, VIP, Online, or delivery claims", () => {
    assert.match(accept, /History/);
    assert.match(accept, /Interactions/);
    assert.match(accept, /Visits done/);
    assert.match(accept, /Customer since/);
    assert.match(accept, /All · Saved · Unsaved/);
    assert.match(accept, /opened-only/);
    assert.match(accept, /inboxRecordHref/);
    assert.match(accept, /Hide when 0/);
    assert.match(note, /History/);
    assert.match(note, /ContactKpiStrip/);
    assert.match(note, /itemSignalLabel/);
    assert.doesNotMatch(accept, /[\u2014\u2013]/);
    assert.doesNotMatch(note, /[\u2014\u2013]/);
  });

  it("renders History from assembled tickets and taps through to a real call", () => {
    assert.match(profile, />History</);
    assert.match(profile, /<ContactTimeline entries=\{timeline\} \/>/);
    assert.match(timeline, /entry\.stamp/);
    assert.match(timeline, /entry\.href/);
    assert.doesNotMatch(timeline, /kindLabel|return "Request"|return "Call"/);
    assert.match(helpers, /buildInboxItem/);
    assert.match(helpers, /itemSignalLabel/);
    assert.match(helpers, /inboxRecordHref/);
    assert.match(load, /contactHistoryEntries/);
    assert.match(load, /toLead/);
    assert.doesNotMatch(profile, /lead_status|Online|last seen|VIP|SEGMENT/);
    assert.doesNotMatch(timeline, /[\u2014\u2013]/);
  });

  it("shows sourced KPI cards only and hides unknown ones", () => {
    assert.match(profile, /<ContactKpiStrip cards=\{kpiCards\} \/>/);
    assert.match(profile, /contactPersonFileKpiCards/);
    assert.match(strip, /data-contact-kpi-strip/);
    assert.match(strip, /data-contact-kpi=\{card\.id\}/);
    assert.match(strip, /if \(!cards\.length\) return null/);
    assert.match(strip, /flex min-w-0 gap-2/);
    assert.doesNotMatch(strip, /backdrop-blur|Online|last seen|VIP|Lead|Cold/);
    assert.doesNotMatch(strip, /[\u2014\u2013]/);
    assert.match(note, /Hide when unknown/);
  });

  it("keeps Contacts list FilterTabs as All Saved Unsaved, not Inbox purpose nouns", () => {
    assert.match(page, /<FilterTabs/);
    assert.match(page, /label="Filter contacts"/);
    assert.match(page, /label: "All"/);
    assert.match(page, /label: "Saved"/);
    assert.match(page, /label: "Unsaved"/);
    assert.doesNotMatch(page, /InboxFilterPills/);
    assert.doesNotMatch(page, /Needs you/);
    assert.doesNotMatch(page, /label: "Human"/);
    assert.doesNotMatch(page, /label: "Answered"/);
    assert.doesNotMatch(page, /label: "VIP"/);
    assert.doesNotMatch(page, /label: "Cold"/);
    assert.doesNotMatch(page, /SEGMENT/);
    assert.doesNotMatch(dev, /label: "Needs you"|label: "Visits"|label: "Holds"/);
  });

  it("keeps Call and WhatsApp opened-only on list and person file", () => {
    assert.match(dock, /<CallLink number=\{number\} \/>/);
    assert.match(row, /<CallLink number=\{number\} \/>/);
    assert.doesNotMatch(dock, /callId=/);
    assert.doesNotMatch(row, /callId=/);
    assert.doesNotMatch(dock, /logWhatsAppFollowUp|lead_status|delivered|Delivered/);
    assert.doesNotMatch(profile, /logWhatsAppFollowUp|delivered|Delivered/);
  });
});
