/**
 * Shared Desk count selector (owner review 18 Oct 2026: Home 76 vs Inbox 31/45, badge 9+).
 * Run: node --experimental-strip-types --no-warnings --test tests/inboxCounts.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deskWorkCounts,
  formatNeedsBadge,
  itemIsToReturn,
  itemNeedsYouNow,
  LIVE_STALE_MS,
  type CountableItem,
} from "../dashboard/src/lib/inboxCounts.ts";

const NOW = Date.parse("2026-10-18T06:00:00Z");
const recent = new Date(NOW - 60 * 60 * 1000).toISOString();
const old = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();

function many(n: number, item: CountableItem): CountableItem[] {
  return Array.from({ length: n }, () => ({ ...item }));
}

// Esga-shaped tape: 31 open human/missed calls, 45 open enquiry/callback
// requests, 5 resolved human calls, one in_progress row from days ago.
const esga: CountableItem[] = [
  ...many(26, { purpose: "human", needsYou: true, createdAt: recent }),
  ...many(5, { purpose: "missed", needsYou: true, createdAt: recent }),
  ...many(40, { purpose: "hold", needsYou: true, createdAt: recent, hold: { status: "open", request_type: "enquiry" } }),
  ...many(5, { purpose: "hold", needsYou: true, createdAt: recent, hold: { status: "open", request_type: "callback" } }),
  ...many(5, { purpose: "human", needsYou: false, createdAt: recent }),
  { purpose: "live", needsYou: true, createdAt: old },
  { purpose: "answered", needsYou: false, createdAt: recent },
  { purpose: "human", needsYou: true, createdAt: recent, lead: { leadStatus: "archived" } },
];

describe("deskWorkCounts", () => {
  it("Home 'Return calls' and the Inbox tab are the same number", () => {
    const c = deskWorkCounts(esga, NOW);
    assert.equal(c.toReturn, 76);
    const tab = esga.filter((item) => itemIsToReturn(item, NOW)).length;
    assert.equal(tab, c.toReturn);
  });

  it("enquiry and callback requests are not Holds", () => {
    assert.equal(deskWorkCounts(esga, NOW).holds, 0);
    const withHold = [...esga, { purpose: "hold", needsYou: true, createdAt: recent, hold: { status: "open", request_type: "hold" } }];
    assert.equal(deskWorkCounts(withHold, NOW).holds, 1);
  });

  it("a stale in_progress call is not live and not in Needs you", () => {
    const c = deskWorkCounts(esga, NOW);
    assert.equal(c.needs, 76);
    assert.equal(itemNeedsYouNow({ purpose: "live", needsYou: true, createdAt: old }, NOW), false);
    const fresh = new Date(NOW - LIVE_STALE_MS + 60_000).toISOString();
    assert.equal(itemNeedsYouNow({ purpose: "live", needsYou: true, createdAt: fresh }, NOW), true);
  });

  it("resolved calls are not to return; archived rows are only archived", () => {
    const c = deskWorkCounts(esga, NOW);
    assert.equal(c.archived, 1);
    assert.equal(c.answered, 1);
  });

  it("visits count requested and confirmed the same everywhere", () => {
    const items: CountableItem[] = [
      ...many(21, { purpose: "job", needsYou: true, createdAt: recent, job: { status: "requested" } }),
      { purpose: "job", needsYou: false, createdAt: recent, job: { status: "confirmed" } },
      { purpose: "job", needsYou: false, createdAt: recent, job: { status: "cancelled" } },
    ];
    const c = deskWorkCounts(items, NOW);
    assert.equal(c.visits, 22);
    assert.equal(c.visitsToConfirm, 21);
    assert.equal(c.toReturn, 0);
  });
});

describe("formatNeedsBadge", () => {
  it("shows the real number up to 99", () => {
    assert.equal(formatNeedsBadge(0), null);
    assert.equal(formatNeedsBadge(9), "9");
    assert.equal(formatNeedsBadge(78), "78");
    assert.equal(formatNeedsBadge(120), "99+");
  });
});
