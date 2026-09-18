const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * Decoupled inbox verb matrix. Keep in lockstep with
 * dashboard/src/lib/inboxPurpose.ts inboxNeedsYou / itemMatchesPurpose /
 * itemIsSnoozed / compareInboxPin / assembleInboxItems snooze skip.
 */
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

function itemMatchesPurpose(item, filter) {
  if (filter === "archived") return itemIsArchived(item);
  if (itemIsArchived(item)) return false;
  if (filter === "all") return true;
  if (filter === "needs") return item.needsYou;
  if (filter === "hold") {
    return String(item.hold?.status || "").toLowerCase() === "open";
  }
  if (filter === "job") {
    const status = String(item.job?.status || "").toLowerCase();
    return status === "requested" || status === "confirmed";
  }
  if (filter === "human") return item.purpose === "human" || item.purpose === "missed";
  if (filter === "answered") return item.purpose === "answered";
  return true;
}

function itemIsSnoozed(item, now) {
  if (!item.snoozedUntil) return false;
  const until = Date.parse(item.snoozedUntil);
  return Number.isFinite(until) && until > now;
}

function compareInboxRecency(a, b) {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

function compareInboxPin(a, b) {
  const ap = a.pinnedAt || "";
  const bp = b.pinnedAt || "";
  if (ap && !bp) return -1;
  if (!ap && bp) return 1;
  if (ap && bp && ap !== bp) return ap < bp ? 1 : -1;
  return 0;
}

function orderInboxItems(items, filter) {
  const rows = [...items];
  if (filter === "all" || filter === "answered" || filter === "archived" || filter === "hold") {
    rows.sort(compareInboxRecency);
  }
  rows.sort(compareInboxPin);
  return rows;
}

const PILES = ["needs", "all", "hold", "job", "human", "answered", "archived"];

function pilesOf(item) {
  return PILES.filter((filter) => itemMatchesPurpose(item, filter));
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
    callerName: "Amina",
    unread: true,
    pinnedAt: null,
    snoozedUntil: null,
    hold: null,
    job: null,
    lead: { leadStatus: "new" },
    ...overrides,
  });
}

function missedReturn(overrides = {}) {
  return refresh({
    id: "missed-1",
    createdAt: "2026-09-18T08:05:00.000Z",
    purpose: "missed",
    unread: false,
    pinnedAt: null,
    snoozedUntil: null,
    hold: null,
    job: null,
    lead: { leadStatus: "new" },
    ...overrides,
  });
}

function requestedVisit(overrides = {}) {
  return refresh({
    id: "job-1",
    createdAt: "2026-09-18T07:00:00.000Z",
    purpose: "job",
    unread: false,
    pinnedAt: null,
    snoozedUntil: null,
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
    pinnedAt: null,
    snoozedUntil: null,
    job: null,
    hold: { status: "open" },
    lead: { leadStatus: "new" },
    ...overrides,
  });
}

function answeredRow(overrides = {}) {
  return refresh({
    id: "answered-1",
    createdAt: "2026-09-18T09:00:00.000Z",
    purpose: "answered",
    unread: false,
    pinnedAt: null,
    snoozedUntil: null,
    hold: null,
    job: null,
    lead: { leadStatus: "resolved" },
    ...overrides,
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

function unarchive(item, next = "new") {
  return refresh({
    ...item,
    lead: { ...(item.lead || {}), leadStatus: next },
  });
}

function pin(item, at = "2026-09-18T12:00:00.000Z") {
  return { ...item, pinnedAt: at };
}

function snooze(item, until = "2026-09-19T08:00:00.000Z") {
  return { ...item, snoozedUntil: until };
}

function markUnread(item) {
  return { ...item, unread: true };
}

function markRead(item) {
  return { ...item, unread: false };
}

function assembleVisible(items, now) {
  return items.filter((item) => !itemIsSnoozed(item, now));
}

function weightOn(item) {
  return Boolean(item.needsYou || item.unread);
}

describe("inbox verb workflows: mark done", () => {
  it("closes a return call: leaves Needs you, stays on All and Human, never becomes Answered", () => {
    const before = humanReturn();
    assert.deepEqual(pilesOf(before), ["needs", "all", "human"]);
    const after = markDone(before);
    assert.equal(after.needsYou, false);
    assert.deepEqual(pilesOf(after), ["all", "human"]);
    assert.equal(after.purpose, "human");
  });

  it("closes a missed return the same way", () => {
    const after = markDone(missedReturn());
    assert.equal(after.needsYou, false);
    assert.deepEqual(pilesOf(after), ["all", "human"]);
  });

  it("does not finish a requested visit: Confirm still owns that row", () => {
    const after = markDone(requestedVisit());
    assert.equal(after.needsYou, true);
    assert.deepEqual(pilesOf(after), ["needs", "all", "job"]);
  });

  it("does not fulfill an open hold: list Done still owns that row", () => {
    const after = markDone(openHold());
    assert.equal(after.needsYou, true);
    assert.deepEqual(pilesOf(after), ["needs", "all", "hold"]);
  });

  it("does not move an answered hangup; that row was already off Needs you", () => {
    const before = answeredRow();
    assert.deepEqual(pilesOf(before), ["all", "answered"]);
    assert.deepEqual(pilesOf(markDone(before)), ["all", "answered"]);
  });
});

describe("inbox verb workflows: confirm visit and hold Done", () => {
  it("Confirm leaves Needs you and stays on Visits until the visit is done", () => {
    const confirmed = refresh({
      ...requestedVisit(),
      job: { status: "confirmed" },
    });
    assert.equal(confirmed.needsYou, false);
    assert.deepEqual(pilesOf(confirmed), ["all", "job"]);
    const visitDone = refresh({
      ...confirmed,
      job: { status: "done" },
      lead: { leadStatus: "resolved" },
    });
    assert.equal(visitDone.needsYou, false);
    assert.deepEqual(pilesOf(visitDone), ["all"]);
  });

  it("Hold Done leaves Needs you and Holds", () => {
    const fulfilled = refresh({
      ...openHold(),
      hold: { status: "fulfilled" },
    });
    assert.equal(fulfilled.needsYou, false);
    assert.deepEqual(pilesOf(fulfilled), ["all"]);
  });
});

describe("inbox verb workflows: archive and unarchive", () => {
  it("Archive is the only leave that exits All. The row sits on Archived only", () => {
    for (const seed of [humanReturn(), requestedVisit(), openHold(), answeredRow()]) {
      const after = archive(seed);
      assert.deepEqual(pilesOf(after), ["archived"]);
    }
  });

  it("does not rewrite job or hold status. needsYou can stay true, but Archived gates the piles", () => {
    const visit = archive(requestedVisit());
    const hold = archive(openHold());
    assert.equal(visit.needsYou, true);
    assert.equal(hold.needsYou, true);
    assert.deepEqual(pilesOf(visit), ["archived"]);
    assert.deepEqual(pilesOf(hold), ["archived"]);
    assert.deepEqual(pilesOf(unarchive(visit, "new")), ["needs", "all", "job"]);
  });

  it("Unarchive is lead_status back to new, contacted, or resolved. There is no list verb", () => {
    const hidden = archive(humanReturn());
    assert.deepEqual(pilesOf(unarchive(hidden, "new")), ["needs", "all", "human"]);
    assert.deepEqual(pilesOf(unarchive(hidden, "contacted")), ["needs", "all", "human"]);
    assert.deepEqual(pilesOf(unarchive(hidden, "resolved")), ["all", "human"]);
  });

  it("Mark done on an archived row is an accidental Unarchive into resolved", () => {
    const after = markDone(archive(humanReturn()));
    assert.deepEqual(pilesOf(after), ["all", "human"]);
    assert.equal(after.lead.leadStatus, "resolved");
  });
});

describe("inbox verb workflows: pin", () => {
  it("does not change piles. It only sorts the current pile", () => {
    const before = humanReturn();
    const after = pin(before);
    assert.deepEqual(pilesOf(before), pilesOf(after));
    const olderPinned = pin(humanReturn({ id: "old", createdAt: "2026-09-16T08:00:00.000Z" }));
    const newer = humanReturn({
      id: "new",
      createdAt: "2026-09-18T10:00:00.000Z",
      pinnedAt: null,
    });
    const ordered = orderInboxItems([newer, olderPinned], "all");
    assert.equal(ordered[0].id, "old");
    assert.equal(ordered[1].id, "new");
  });

  it("still pins inside Archived", () => {
    const pinned = pin(archive(humanReturn({ id: "pinned-arch", createdAt: "2026-09-16T08:00:00.000Z" })));
    const later = archive(humanReturn({ id: "later-arch", createdAt: "2026-09-18T10:00:00.000Z" }));
    const ordered = orderInboxItems([later, pinned], "archived");
    assert.equal(ordered[0].id, "pinned-arch");
  });
});

describe("inbox verb workflows: snooze", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");

  it("is a 24h hide in assemble, not a pile. itemMatchesPurpose would still keep it", () => {
    const row = snooze(humanReturn(), "2026-09-19T08:00:00.000Z");
    assert.equal(itemIsSnoozed(row, now), true);
    assert.deepEqual(pilesOf(row), ["needs", "all", "human"]);
    assert.deepEqual(
      assembleVisible([row, answeredRow()], now).map((item) => item.id),
      ["answered-1"]
    );
  });

  it("also hides archived rows. There is no Snoozed folder and no unsnooze", () => {
    const row = snooze(archive(humanReturn()), "2026-09-19T08:00:00.000Z");
    assert.equal(itemIsSnoozed(row, now), true);
    assert.deepEqual(assembleVisible([row], now), []);
    assert.deepEqual(pilesOf(row), ["archived"]);
  });

  it("returns the row to its original piles when due", () => {
    const row = snooze(humanReturn(), "2026-09-18T10:00:00.000Z");
    assert.equal(itemIsSnoozed(row, now), false);
    assert.deepEqual(
      assembleVisible([row], now).map((item) => item.id),
      ["human-1"]
    );
    assert.deepEqual(pilesOf(row), ["needs", "all", "human"]);
  });
});

describe("inbox verb workflows: mark unread", () => {
  it("does not change piles. Weight is needsYou OR unread, with no Unread filter", () => {
    const open = humanReturn({ unread: false });
    assert.equal(weightOn(open), true);
    assert.deepEqual(pilesOf(open), pilesOf(markUnread(open)));
    const closed = markDone(humanReturn({ unread: false }));
    assert.equal(weightOn(closed), false);
    assert.equal(weightOn(markUnread(closed)), true);
    assert.deepEqual(pilesOf(markUnread(closed)), ["all", "human"]);
  });

  it("new calls are unread when inbox_read_at is null. Opening a ticket does not stamp read", () => {
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    const sql = read("docs/supabase/inbox_triage.sql");
    const ticket = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    assert.match(purpose, /unread: lead\?\.call\.inbox_read_at === null/);
    assert.match(sql, /New calls are unread \(inbox_read_at null\)/);
    assert.doesNotMatch(ticket, /inboxToggleRead|inbox_read_at/);
  });
});

describe("inbox verb workflows: surfaces as shipped", () => {
  it("overflow is six verbs. Unread and Snooze sit in the stay group", () => {
    const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
    for (const label of ["Select", "Mark unread", "Pin", "Snooze", "Mark done", "Archive"]) {
      assert.match(overflow, new RegExp(label));
    }
    assert.doesNotMatch(overflow, /Unarchive/);
    assert.match(overflow, /id === "snooze" \|\| id === "archive"/);
    assert.doesNotMatch(overflow, /id === "done" \|\| id === "archive"/);
  });

  it("phone More exists only to park unread and snooze. Desktop bulk already omits them", () => {
    const select = read("dashboard/src/components/InboxRowSelect.tsx");
    assert.match(select, /id: "unread" as const/);
    assert.match(select, /id: "snooze" as const/);
    assert.match(select, /kind === "done" \|\| kind === "archive" \|\| kind === "snooze"/);
    const desktop = select.slice(select.indexOf("hidden min-h-11"));
    assert.match(desktop, /Mark done/);
    assert.match(desktop, /Archive/);
    assert.match(desktop, /Pin/);
    assert.match(desktop, /Cancel/);
    assert.doesNotMatch(desktop, /Mark unread|Snooze/);
  });

  it("ticket Archive hides when archived. Unarchive is only LeadStatusToggle chips", () => {
    const ticket = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    const toggle = read("dashboard/src/components/LeadStatusToggle.tsx");
    assert.match(ticket, /leadStatus !== "archived"/);
    assert.match(toggle, /id: "new"/);
    assert.match(toggle, /id: "contacted"/);
    assert.match(toggle, /id: "resolved"/);
    assert.doesNotMatch(toggle, /id: "archived"/);
    assert.match(toggle, /status === "archived"/);
  });

  it("FilterTabs have no Unread or Snoozed. Archived is a folder row", () => {
    const niche = read("dashboard/src/lib/inboxNiche.ts");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    assert.match(niche, /id: "needs"/);
    assert.match(niche, /id: "all"/);
    assert.match(niche, /id: "job"/);
    assert.match(niche, /id: "hold"/);
    assert.match(niche, /id: "human"/);
    assert.match(niche, /id: "answered"/);
    assert.doesNotMatch(niche, /Unread|Snooze/);
    assert.match(page, /InboxArchivedPhoneRow/);
    assert.match(page, /showArchivedEntry/);
  });

  it("dock verbs stay Confirm, hold Done, Call, WhatsApp. They are not overflow verbs", () => {
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
    assert.match(row, /InboxJobActions/);
    assert.match(row, /RequestStatusToggle/);
    assert.match(row, /CallLink/);
    assert.match(row, /WhatsAppLink/);
    assert.doesNotMatch(overflow, /Confirm/);
    assert.doesNotMatch(overflow, /WhatsApp/);
  });
});
