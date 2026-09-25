const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

/** Latest customer-originated timestamp: inbound call, hold, or visit. */
function inboxLastCustomerEventAt({ callCreatedAt, holdCreatedAt, jobCreatedAt }) {
  let latest = null;
  let latestMs = -Infinity;
  for (const iso of [callCreatedAt, holdCreatedAt, jobCreatedAt]) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms >= latestMs) {
      latestMs = ms;
      latest = iso;
    }
  }
  return latest;
}

/** Unread iff a customer event exists after the owner last opened the ticket. */
function inboxIsUnread({ lastCustomerEventAt, inboxReadAt }) {
  const eventMs = lastCustomerEventAt ? Date.parse(lastCustomerEventAt) : NaN;
  if (!Number.isFinite(eventMs)) return false;
  if (!inboxReadAt) return true;
  const readMs = Date.parse(inboxReadAt);
  if (!Number.isFinite(readMs)) return true;
  return eventMs > readMs;
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

function rowDotOn(item) {
  return Boolean(item.unread);
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
    unread: inboxIsUnread({
      lastCustomerEventAt: inboxLastCustomerEventAt({
        callCreatedAt: item.lead?.call?.created_at || item.createdAt,
        holdCreatedAt: item.hold?.created_at,
        jobCreatedAt: item.job?.created_at,
      }),
      inboxReadAt: item.lead?.call?.inbox_read_at,
    }),
  };
}

function humanReturn(overrides = {}) {
  return refresh({
    id: "human-1",
    createdAt: "2026-09-18T08:00:00.000Z",
    purpose: "human",
    hold: null,
    job: null,
    lead: {
      leadStatus: "new",
      call: { created_at: "2026-09-18T08:00:00.000Z", inbox_read_at: null },
    },
    ...overrides,
  });
}

function requestedVisit(overrides = {}) {
  return refresh({
    id: "job-1",
    createdAt: "2026-09-18T07:00:00.000Z",
    purpose: "job",
    hold: null,
    job: { status: "requested", created_at: "2026-09-18T07:00:00.000Z" },
    lead: {
      leadStatus: "new",
      call: { created_at: "2026-09-18T07:00:00.000Z", inbox_read_at: "2026-09-18T09:00:00.000Z" },
    },
    ...overrides,
  });
}

function openHold(overrides = {}) {
  return refresh({
    id: "hold-1",
    createdAt: "2026-09-18T07:30:00.000Z",
    purpose: "hold",
    job: null,
    hold: { status: "open", created_at: "2026-09-18T07:30:00.000Z" },
    lead: {
      leadStatus: "new",
      call: { created_at: "2026-09-18T07:30:00.000Z", inbox_read_at: "2026-09-18T09:00:00.000Z" },
    },
    ...overrides,
  });
}

function answeredRow() {
  return refresh({
    id: "answered-1",
    createdAt: "2026-09-18T09:00:00.000Z",
    purpose: "answered",
    hold: null,
    job: null,
    lead: {
      leadStatus: "resolved",
      call: { created_at: "2026-09-18T09:00:00.000Z", inbox_read_at: null },
    },
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

/** Opening /calls/[id] stamps inbox_read_at via inboxMarkSeen. */
function simulateTicketOpen(item, at = "2026-09-19T12:00:00.000Z") {
  return refresh({
    ...item,
    lead: {
      ...(item.lead || {}),
      call: {
        ...(item.lead?.call || {}),
        inbox_read_at: at,
      },
    },
  });
}

describe("inbox unread since last customer event", () => {
  it("is unread when a customer event exists and the ticket was never opened", () => {
    const lastCustomerEventAt = inboxLastCustomerEventAt({
      callCreatedAt: "2026-09-18T08:00:00.000Z",
    });
    assert.equal(lastCustomerEventAt, "2026-09-18T08:00:00.000Z");
    assert.equal(
      inboxIsUnread({ lastCustomerEventAt, inboxReadAt: null }),
      true
    );
    const row = humanReturn();
    assert.equal(row.unread, true);
    assert.equal(rowDotOn(row), true);
  });

  it("is read after opening when no later customer event exists", () => {
    const lastCustomerEventAt = inboxLastCustomerEventAt({
      callCreatedAt: "2026-09-18T08:00:00.000Z",
      holdCreatedAt: "2026-09-18T08:01:00.000Z",
    });
    assert.equal(
      inboxIsUnread({
        lastCustomerEventAt,
        inboxReadAt: "2026-09-18T09:00:00.000Z",
      }),
      false
    );
  });

  it("is unread when a hold or visit is created after last open", () => {
    assert.equal(
      inboxIsUnread({
        lastCustomerEventAt: inboxLastCustomerEventAt({
          callCreatedAt: "2026-09-18T08:00:00.000Z",
          holdCreatedAt: "2026-09-18T10:00:00.000Z",
        }),
        inboxReadAt: "2026-09-18T09:00:00.000Z",
      }),
      true
    );
    assert.equal(
      inboxIsUnread({
        lastCustomerEventAt: inboxLastCustomerEventAt({
          callCreatedAt: "2026-09-18T08:00:00.000Z",
          jobCreatedAt: "2026-09-18T10:30:00.000Z",
        }),
        inboxReadAt: "2026-09-18T09:00:00.000Z",
      }),
      true
    );
  });

  it("is not unread when there is no customer event timestamp", () => {
    assert.equal(
      inboxIsUnread({
        lastCustomerEventAt: inboxLastCustomerEventAt({}),
        inboxReadAt: null,
      }),
      false
    );
  });

  it("wires last-open vs last-customer-event into InboxItem.unread", () => {
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    assert.match(purpose, /export function inboxLastCustomerEventAt/);
    assert.match(purpose, /export function inboxIsUnread/);
    assert.match(purpose, /unread: inboxIsUnread\(/);
    assert.match(purpose, /callCreatedAt: lead\?\.call\.created_at/);
    assert.match(purpose, /holdCreatedAt: hold\?\.created_at/);
    assert.match(purpose, /jobCreatedAt: job\?\.created_at/);
    assert.match(purpose, /inboxReadAt: lead\?\.call\.inbox_read_at/);
    assert.doesNotMatch(purpose, /unread: lead\?\.call\.inbox_read_at === null/);
  });

  it("stamps calls.inbox_read_at when opening /calls/[id]", () => {
    const actions = read("dashboard/src/app/(desk)/calls/inboxTriageActions.ts");
    const leads = read("dashboard/src/lib/inboxLeadActions.ts");
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const page = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    assert.match(actions, /export async function inboxMarkSeen/);
    assert.match(actions, /inbox_read_at: new Date\(\)\.toISOString\(\)/);
    assert.match(leads, /export async function inboxMarkSeen/);
    assert.match(ticket, /inboxMarkSeen\(callId\)/);
    assert.match(page, /InboxTicketView/);
    assert.doesNotMatch(ticket, /id: "unread"/);
    assert.doesNotMatch(ticket, /Mark unread/);
    assert.doesNotMatch(ticket, /["']Snooze["']/);
    const opened = simulateTicketOpen(humanReturn());
    assert.equal(opened.unread, false);
    assert.equal(rowDotOn(opened), false);
    assert.equal(opened.lead.call.inbox_read_at, "2026-09-19T12:00:00.000Z");
  });

  it("shows the blue dot and unread weight only when unread is true", () => {
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    const desk = read("dashboard/src/components/ui/deskRow.tsx");
    assert.match(row, /RowStateDot show=\{item\.unread\}/);
    assert.match(row, /deskRowWeightClass\(item\.unread\)/);
    assert.doesNotMatch(row, /itemInNeedsYouPile/);
    assert.doesNotMatch(row, /RowStateDot show=\{item\.needsYou\}/);
    assert.doesNotMatch(row, /RowStateDot show=\{needsYouPile\}/);
    assert.doesNotMatch(row, /deskRowWeightClass\(needsYouPile\)/);
    assert.doesNotMatch(row, /deskRowWeightClass\(item\.needsYou \|\| item\.unread\)/);
    assert.match(desk, /aria-label="Unread"/);
    assert.doesNotMatch(desk, /aria-label="Needs you"/);
  });

  it("keeps the Inbox nav badge as Needs you count, not unread", () => {
    const load = read("dashboard/src/lib/inboxLoad.ts");
    const layout = read("dashboard/src/app/(desk)/layout.tsx");
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    assert.match(load, /countInboxPurposes\(inbox\.items\)\.needs/);
    assert.match(layout, /loadCachedInboxNeedsCount/);
    assert.match(purpose, /export function itemInNeedsYouPile/);
    assert.match(purpose, /if \(itemInNeedsYouPile\(item\)\) counts\.needs \+= 1/);
    assert.doesNotMatch(load, /countInboxPurposes\(inbox\.items\)\.unread/);
    assert.doesNotMatch(load, /items\.filter\(\(item\) => item\.unread\)/);
  });
});

describe("inbox unread and Needs you are two signals", () => {
  it("needsYou can stay true after open so the badge still counts the row", () => {
    const opened = simulateTicketOpen(humanReturn());
    assert.equal(opened.unread, false);
    assert.equal(rowDotOn(opened), false);
    assert.equal(opened.needsYou, true);
    assert.equal(itemInNeedsYouPile(opened), true);
    assert.equal(itemInNeedsYouPile(simulateTicketOpen(requestedVisit())), true);
    assert.equal(itemInNeedsYouPile(simulateTicketOpen(openHold())), true);
    assert.equal(
      countInboxPurposesNeeds([opened, simulateTicketOpen(requestedVisit()), answeredRow()]),
      2
    );
  });

  it("Confirm, hold Done, Mark done, and Archive leave the needs pile independently of unread", () => {
    const unreadHuman = humanReturn();
    assert.equal(unreadHuman.unread, true);
    assert.equal(itemInNeedsYouPile(unreadHuman), true);

    const afterArchive = archive(unreadHuman);
    assert.equal(afterArchive.unread, true);
    assert.equal(itemInNeedsYouPile(afterArchive), false);

    const afterDone = markDone(unreadHuman);
    assert.equal(afterDone.unread, true);
    assert.equal(itemInNeedsYouPile(afterDone), false);

    const afterConfirm = confirmVisit(requestedVisit());
    assert.equal(itemInNeedsYouPile(afterConfirm), false);

    const afterHoldDone = holdDone(openHold());
    assert.equal(itemInNeedsYouPile(afterHoldDone), false);

    const items = [
      unreadHuman,
      afterArchive,
      afterDone,
      afterConfirm,
      afterHoldDone,
      answeredRow(),
    ];
    assert.equal(countInboxPurposesNeeds(items), 1);
    assert.equal(items.filter(rowDotOn).length, 4);
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
    assert.match(ticket, /inboxTicketOverflowActions\(\{ archived \}\)/);
    assert.match(ticket, /action\.label/);
    assert.doesNotMatch(ticket, /id: "pin"/);
    assert.doesNotMatch(ticket, /id: "unread"/);
    assert.doesNotMatch(ticket, /id: "snooze"/);
    assert.doesNotMatch(ticket, /label: "Select"/);
    assert.doesNotMatch(ticket, /role="dialog"/);
    assert.doesNotMatch(ticket, /setSheet|mode === "sheet"|coarse \? "sheet"/);
    assert.doesNotMatch(ticket, /Mark unread/);
    assert.doesNotMatch(ticket, /["']Snooze["']/);
    assert.doesNotMatch(ticket, /Unpin/);
    assert.doesNotMatch(ticket, /id === "mark_done"/);
    assert.match(verbs, /label: "Mark done"/);
    assert.match(verbs, /Mark done lives on the action dock/);
  });

  it("list overflow stays Pin, Mark done, Archive on md+", () => {
    const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(overflow, /inboxOverflowActions\(inboxItemWithLocal\(item, local\)\)/);
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
