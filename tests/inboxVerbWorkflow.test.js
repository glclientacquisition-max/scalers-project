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
  return Boolean(item.unread);
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

  it("Unarchive writes lead_status new and restores Needs you", () => {
    const hidden = archive(humanReturn());
    assert.deepEqual(pilesOf(unarchive(hidden, "new")), ["needs", "all", "human"]);
    assert.deepEqual(pilesOf(unarchive(hidden, "contacted")), ["needs", "all", "human"]);
    assert.deepEqual(pilesOf(unarchive(hidden, "resolved")), ["all", "human"]);
  });

  it("Mark done on an archived row would still resolve it if called. Overflow must not offer it", () => {
    const after = markDone(archive(humanReturn()));
    assert.deepEqual(pilesOf(after), ["all", "human"]);
    assert.equal(after.lead.leadStatus, "resolved");
    assert.deepEqual(
      inboxOverflowActions(archive(humanReturn())).map((row) => row.id),
      ["pin", "unarchive"]
    );
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
  it("does not change piles. Weight follows unread, with no Unread filter", () => {
    const open = humanReturn({ unread: false });
    assert.equal(weightOn(open), false);
    assert.equal(open.needsYou, true);
    assert.deepEqual(pilesOf(open), pilesOf(markUnread(open)));
    const closed = markDone(humanReturn({ unread: false }));
    assert.equal(weightOn(closed), false);
    assert.equal(weightOn(markUnread(closed)), true);
    assert.deepEqual(pilesOf(markUnread(closed)), ["all", "human"]);
  });

  it("unread is last customer event after last open. Opening a ticket stamps inbox_read_at", () => {
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const actions = read("dashboard/src/app/(desk)/calls/inboxTriageActions.ts");
    assert.match(purpose, /export function inboxIsUnread/);
    assert.match(purpose, /unread: inboxIsUnread\(/);
    assert.match(actions, /export async function inboxMarkSeen/);
    assert.match(ticket, /inboxMarkSeen\(callId\)/);
    assert.doesNotMatch(ticket, /Mark unread/);
    const opened = markRead(humanReturn({ unread: true }));
    assert.equal(weightOn(opened), false);
    assert.equal(opened.needsYou, true);
  });
});

function inboxCanMarkDone(item) {
  if (itemIsArchived(item)) return false;
  if (item.job || item.hold) return false;
  if (item.purpose !== "human" && item.purpose !== "missed") return false;
  return String(item.lead?.leadStatus || "").toLowerCase() !== "resolved";
}

function inboxOverflowActions(item) {
  const stay = [item.pinnedAt ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin" }];
  if (inboxCanMarkDone(item)) stay.push({ id: "mark_done", label: "Mark done" });
  if (itemIsArchived(item)) return [...stay, { id: "unarchive", label: "Unarchive" }];
  return [...stay, { id: "archive", label: "Archive" }];
}

describe("inbox verb workflows: overflow menu", () => {
  it("offers Pin, Mark done on return calls, Archive, or Unarchive on Archived", () => {
    assert.deepEqual(
      inboxOverflowActions(humanReturn()).map((row) => row.id),
      ["pin", "mark_done", "archive"]
    );
    assert.deepEqual(
      inboxOverflowActions(requestedVisit()).map((row) => row.id),
      ["pin", "archive"]
    );
    assert.deepEqual(
      inboxOverflowActions(openHold()).map((row) => row.id),
      ["pin", "archive"]
    );
    assert.deepEqual(
      inboxOverflowActions(answeredRow()).map((row) => row.id),
      ["pin", "archive"]
    );
    assert.deepEqual(
      inboxOverflowActions(archive(humanReturn())).map((row) => row.id),
      ["pin", "unarchive"]
    );
    assert.deepEqual(
      inboxOverflowActions(pin(humanReturn())).map((row) => row.id),
      ["unpin", "mark_done", "archive"]
    );
  });
});

describe("inbox verb workflows: surfaces as shipped", () => {
  it("overflow drops unread and snooze and calls inboxOverflowActions", () => {
    const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(overflow, /inboxOverflowActions\(item\)/);
    assert.match(verbs, /export function inboxOverflowActions/);
    assert.match(verbs, /label: "Archive"/);
    assert.match(verbs, /label: "Unarchive"/);
    assert.match(verbs, /label: "Pin"/);
    assert.match(verbs, /Mark done/);
    assert.doesNotMatch(overflow, /id: "unread"/);
    assert.doesNotMatch(overflow, /id: "snooze"/);
    assert.doesNotMatch(overflow, /Mark unread/);
    assert.doesNotMatch(overflow, /["']Snooze["']/);
  });

  it("phone select bar has no More sheet. Bulk Confirm and Done are eligibility gated", () => {
    const select = read("dashboard/src/components/InboxRowSelect.tsx");
    const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
    assert.doesNotMatch(select, /aria-label="More"/);
    assert.doesNotMatch(select, /id: "unread"/);
    assert.doesNotMatch(select, /id: "snooze"/);
    assert.match(select, /kind === "archive"/);
    assert.match(select, /inboxBulkActions/);
    assert.doesNotMatch(select, /inboxTogglePin/);
    assert.match(select, /inboxMarkDone/);
    assert.doesNotMatch(select, /aria-label=\{allPinned/);
    assert.match(select, /aria-label="Close"/);
    assert.doesNotMatch(select, /aria-label="Back"/);
    assert.doesNotMatch(overflow, /role="dialog"/);
    assert.doesNotMatch(overflow, /coarse \? "sheet"/);
    assert.match(overflow, /hidden md:inline-flex/);
    assert.doesNotMatch(select, /Mark unread|Snooze/);
  });

  it("ticket stamp is read-only. Archive lives on More", () => {
    const ticket = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    const view = read("dashboard/src/components/InboxTicketView.tsx");
    assert.doesNotMatch(ticket, /LeadStatusToggle/);
    assert.doesNotMatch(ticket, /MarkLeadUnarchiveButton/);
    assert.doesNotMatch(ticket, /MarkLeadDoneButton/);
    assert.match(view, /InboxPurposeChip/);
    assert.match(view, /updateLeadStatus\(callId, archived \? "new" : "archived"\)/);
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
