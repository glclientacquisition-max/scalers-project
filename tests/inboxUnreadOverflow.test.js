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
  });

  it("shows the blue dot and unread weight only when unread is true", () => {
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    const desk = read("dashboard/src/components/ui/deskRow.tsx");
    assert.match(row, /RowStateDot show=\{item\.unread\}/);
    assert.match(row, /deskRowWeightClass\(item\.unread\)/);
    assert.doesNotMatch(row, /RowStateDot show=\{item\.needsYou\}/);
    assert.doesNotMatch(row, /deskRowWeightClass\(item\.needsYou \|\| item\.unread\)/);
    assert.match(desk, /aria-label="Unread"/);
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
