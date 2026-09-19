const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function inboxNeedsYou({ purpose, leadStatus, hold, job }) {
  if (purpose === "live") return true;
  if (purpose === "answered") return false;
  const jobStatus = String(job?.status || "").toLowerCase();
  const holdStatus = String(hold?.status || "").toLowerCase();
  if (job && jobStatus === "requested") return true;
  if (hold && holdStatus === "open") return true;
  const leadOpen = leadStatus !== "resolved" && leadStatus !== "archived";
  if (purpose === "job" && !job && leadOpen) return true;
  if (purpose === "hold" && !hold && leadOpen) return true;
  if (purpose === "human" && leadOpen) return true;
  if (purpose === "missed" && leadOpen) return true;
  return false;
}

function itemIsArchived(item) {
  return item.lead?.leadStatus === "archived";
}

/** Same set as countInboxPurposes(items).needs and the Inbox nav badge. */
function itemInNeedsYouPile(item) {
  return Boolean(item.needsYou) && !itemIsArchived(item);
}

function countInboxPurposesNeeds(items) {
  return items.filter(itemInNeedsYouPile).length;
}

function refresh(item) {
  return {
    ...item,
    needsYou: inboxNeedsYou({
      purpose: item.purpose,
      leadStatus: item.lead?.leadStatus,
      hold: item.hold,
      job: item.job,
    }),
  };
}

function humanReturn(overrides = {}) {
  return refresh({
    id: "human-1",
    createdAt: "2026-09-18T08:00:00.000Z",
    purpose: "human",
    unread: true,
    hold: null,
    job: null,
    lead: { leadStatus: "new", call: { inbox_read_at: null } },
    ...overrides,
  });
}

function requestedVisit(overrides = {}) {
  return refresh({
    id: "job-1",
    createdAt: "2026-09-18T07:00:00.000Z",
    purpose: "job",
    unread: false,
    hold: null,
    job: { status: "requested" },
    lead: { leadStatus: "new" },
    ...overrides,
  });
}

function openHold(overrides = {}) {
  return refresh({
    id: "hold-1",
    createdAt: "2026-09-18T07:30:00.000Z",
    purpose: "hold",
    unread: false,
    job: null,
    hold: { status: "open" },
    lead: { leadStatus: "new" },
    ...overrides,
  });
}

function answeredRow() {
  return refresh({
    id: "answered-1",
    createdAt: "2026-09-18T09:00:00.000Z",
    purpose: "answered",
    unread: true,
    hold: null,
    job: null,
    lead: { leadStatus: "resolved" },
  });
}

function markDone(item) {
  return refresh({
    ...item,
    lead: { ...(item.lead || {}), leadStatus: "resolved" },
  });
}

function archive(item) {
  return refresh({
    ...item,
    lead: { ...(item.lead || {}), leadStatus: "archived" },
  });
}

function confirmVisit(item) {
  return refresh({
    ...item,
    job: { ...(item.job || {}), status: "confirmed" },
  });
}

function holdDone(item) {
  return refresh({
    ...item,
    hold: { ...(item.hold || {}), status: "fulfilled" },
  });
}

/** Opening /calls/[id] no longer stamps seen. Unread may flip; the pile does not. */
function simulateTicketOpen(item) {
  return {
    ...item,
    unread: false,
    lead: {
      ...(item.lead || {}),
      call: {
        ...(item.lead?.call || {}),
        inbox_read_at: "2026-09-19T12:00:00.000Z",
      },
    },
  };
}

describe("inbox row dot matches Needs you", () => {
  it("is on for unarchived needsYou rows", () => {
    assert.equal(itemInNeedsYouPile(humanReturn()), true);
    assert.equal(itemInNeedsYouPile(requestedVisit()), true);
    assert.equal(itemInNeedsYouPile(openHold()), true);
    assert.equal(itemInNeedsYouPile(answeredRow()), false);
  });

  it("clears after archive, confirm, hold Done, and mark done", () => {
    assert.equal(itemInNeedsYouPile(archive(humanReturn())), false);
    assert.equal(itemInNeedsYouPile(archive(requestedVisit())), false);
    assert.equal(itemInNeedsYouPile(confirmVisit(requestedVisit())), false);
    assert.equal(itemInNeedsYouPile(holdDone(openHold())), false);
    assert.equal(itemInNeedsYouPile(markDone(humanReturn())), false);
  });

  it("stays on after a simulated ticket open", () => {
    const opened = simulateTicketOpen(humanReturn());
    assert.equal(opened.unread, false);
    assert.equal(opened.lead.call.inbox_read_at, "2026-09-19T12:00:00.000Z");
    assert.equal(itemInNeedsYouPile(opened), true);
    assert.equal(itemInNeedsYouPile(simulateTicketOpen(requestedVisit())), true);
  });

  it("dots the same set as countInboxPurposes.needs", () => {
    const items = [
      humanReturn(),
      requestedVisit(),
      openHold(),
      answeredRow(),
      archive(humanReturn()),
      markDone(humanReturn()),
      confirmVisit(requestedVisit()),
    ];
    const dotted = items.filter(itemInNeedsYouPile);
    assert.equal(dotted.length, 3);
    assert.equal(countInboxPurposesNeeds(items), dotted.length);
    assert.deepEqual(
      dotted.map((row) => row.id),
      ["human-1", "job-1", "hold-1"]
    );
  });

  it("wires the list dot and weight to itemInNeedsYouPile, not unread", () => {
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    const desk = read("dashboard/src/components/ui/deskRow.tsx");
    assert.match(purpose, /export function itemInNeedsYouPile/);
    assert.match(purpose, /item\.needsYou\) && !itemIsArchived\(item\)/);
    assert.match(purpose, /if \(itemInNeedsYouPile\(item\)\) counts\.needs \+= 1/);
    assert.match(row, /itemInNeedsYouPile\(item\)/);
    assert.match(row, /RowStateDot show=\{needsYouPile\}/);
    assert.match(row, /deskRowWeightClass\(needsYouPile\)/);
    assert.doesNotMatch(row, /RowStateDot show=\{item\.unread\}/);
    assert.doesNotMatch(row, /deskRowWeightClass\(item\.unread\)/);
    assert.match(desk, /aria-label="Needs you"/);
  });

  it("does not stamp inbox_read_at when opening /calls/[id]", () => {
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const page = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    assert.match(page, /InboxTicketView/);
    assert.doesNotMatch(ticket, /inboxMarkSeen/);
    assert.doesNotMatch(ticket, /id: "unread"/);
    assert.doesNotMatch(ticket, /Mark unread/);
    assert.doesNotMatch(ticket, /["']Snooze["']/);
  });

  it("keeps the Inbox nav badge as Needs you count, not unread", () => {
    const load = read("dashboard/src/lib/inboxLoad.ts");
    const layout = read("dashboard/src/app/(desk)/layout.tsx");
    assert.match(load, /countInboxPurposes\(inbox\.items\)\.needs/);
    assert.match(layout, /loadCachedInboxNeedsCount/);
    assert.doesNotMatch(load, /countInboxPurposes\(inbox\.items\)\.unread/);
    assert.doesNotMatch(load, /items\.filter\(\(item\) => item\.unread\)/);
  });
});

describe("inbox ticket overflow menu", () => {
  it("portals a 44px Archive or Unarchive menu aligned to More", () => {
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(ticket, /createPortal/);
    assert.match(ticket, /document\.body/);
    assert.match(ticket, /placeInboxOverflowMenu/);
    assert.match(ticket, /position: "fixed"/);
    assert.match(ticket, /min-h-11/);
    assert.match(ticket, /z-\[60\]/);
    assert.match(verbs, /export function inboxTicketOverflowActions/);
    assert.match(ticket, /inboxTicketOverflowActions\(archived\)/);
    assert.match(ticket, /archived \? "Unarchive" : "Archive"/);
    assert.doesNotMatch(ticket, /id: "pin"/);
    assert.doesNotMatch(ticket, /id: "unread"/);
    assert.doesNotMatch(ticket, /id: "snooze"/);
    assert.doesNotMatch(ticket, /label: "Select"/);
    assert.doesNotMatch(ticket, /role="dialog"/);
    assert.doesNotMatch(ticket, /setSheet|mode === "sheet"|coarse \? "sheet"/);
    assert.doesNotMatch(ticket, /Mark unread/);
    assert.doesNotMatch(ticket, /["']Snooze["']/);
    assert.doesNotMatch(ticket, /Unpin/);
    assert.doesNotMatch(ticket, /Mark done/);
  });

  it("list overflow stays Pin, Mark done, Archive on md+", () => {
    const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(overflow, /inboxOverflowActions\(item\)/);
    assert.match(overflow, /placeInboxOverflowMenu/);
    assert.match(overflow, /createPortal/);
    assert.match(overflow, /document\.body/);
    assert.match(overflow, /hidden md:inline-flex/);
    assert.match(overflow, /min-h-11/);
    assert.match(overflow, /z-\[60\]/);
    assert.match(verbs, /label: "Pin"/);
    assert.match(verbs, /Mark done/);
    assert.match(verbs, /label: "Archive"/);
    assert.match(verbs, /label: "Unarchive"/);
    assert.doesNotMatch(overflow, /id: "unread"/);
    assert.doesNotMatch(overflow, /Mark unread/);
    assert.doesNotMatch(overflow, /["']Snooze["']/);
  });
});
