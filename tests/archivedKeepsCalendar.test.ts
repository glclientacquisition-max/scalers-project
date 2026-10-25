// Archive only tidies the inbox. An archived call keeps ALL its visits and
// holds on Visits Week, Visits Today, Holds Today and Home "today", including
// the first visit or hold that sits on the call's own row (the old #329 rule
// dropped that one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleInboxItems, itemIsArchived, itemMatchesPurpose } from "../dashboard/src/lib/inboxPurpose.ts";
import { groupVisitBoardForWeek, visitBoardForDay, visitBoardItems } from "../dashboard/src/lib/runSheet.ts";
import { holdBoardForDay, holdBoardItems, isHoldBoardItem } from "../dashboard/src/lib/holdSheet.ts";

const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");

const CALL = "2af42c11-4344-46d0-ad48-92d0a38e0dfb";
const NOW = new Date("2026-10-22T05:00:00.000Z"); // 08:00 EAT
const TODAY = "2026-10-22";
const MONDAY = "2026-10-19";
const STAMP = "2026-10-22T04:50:00.000Z";

function lead(id: string, leadStatus: string) {
  return {
    call: { id, created_at: "2026-10-21T04:30:00.000Z", status: "completed", caller_number: "+254700000001" },
    leadStatus,
    reason: "Booking",
    name: "Wanjiku",
    primaryIntent: "booking",
    resolution: "unknown",
    urgent: false,
  } as any;
}

function job(id: string, callId: string, extra: Record<string, unknown> = {}) {
  return {
    id, created_at: "2026-10-21T04:33:00.000Z", service_name: "Deep clean", status: "confirmed",
    when_text: null, window_start: "2026-10-22T07:00:00.000Z", window_end: null,
    address_landmark: null, notes: null, caller_name: "Wanjiku", caller_phone: "+254700000001", call_id: callId, ...extra,
  } as any;
}

function hold(id: string, callId: string, extra: Record<string, unknown> = {}) {
  return {
    id, created_at: "2026-10-21T04:33:00.000Z", request_type: "order", status: "open", item: "Cake",
    quantity: 1, when_text: null, window_start: "2026-10-22T11:00:00.000Z", window_end: null,
    notes: null, caller_name: "Wanjiku", caller_phone: "+254700000001", call_id: callId, ...extra,
  } as any;
}

const visitRowItem = (status: string) =>
  ({ id: CALL, callId: CALL, callerName: "Wanjiku", lead: { leadStatus: status }, hold: null, job: job("v-1", CALL) }) as any;
const holdRowItem = (status: string) =>
  ({ id: CALL, callId: CALL, callerName: "Wanjiku", lead: { leadStatus: status }, hold: hold("h-1", CALL), job: null }) as any;

test("archived call with a visit on its row: still on Visits Week, Visits Today and Home today", () => {
  const item = visitRowItem("archived");
  assert.equal(itemIsArchived(item), true, "out of the inbox");
  assert.equal(itemMatchesPurpose(item, "job"), false, "not in the inbox Visits list");
  assert.equal(itemMatchesPurpose(item, "archived"), true, "in Archived");
  assert.deepEqual(visitBoardItems([item]).map((i) => i.id), [CALL], "Visits Week input");
  const week = groupVisitBoardForWeek([item], MONDAY, NOW);
  assert.deepEqual(week.byDay[TODAY].map((v) => v.id), ["v-1"], "Visits Week, Thursday column");
  // Visits Today and Home "today" both read visitBoardForDay.
  assert.deepEqual(visitBoardForDay([item], TODAY, NOW).map((i) => i.id), [CALL], "Visits Today and Home today");
});

test("archived call with a hold on its row: still on Holds Today", () => {
  const item = holdRowItem("archived");
  assert.equal(itemIsArchived(item), true, "out of the inbox");
  assert.equal(itemMatchesPurpose(item, "hold"), false, "not in the inbox Holds list");
  assert.equal(isHoldBoardItem(item), true);
  assert.deepEqual(holdBoardItems([item]).map((i) => i.id), [CALL]);
  assert.deepEqual(holdBoardForDay([item], TODAY, NOW).map((i) => i.id), [CALL], "Holds Today");
});

test("archived and live calls give the same calendar and run sheets", () => {
  for (const make of [visitRowItem, holdRowItem]) {
    const live = make("new");
    const archived = make("archived");
    assert.deepEqual(visitBoardForDay([archived], TODAY, NOW), visitBoardForDay([live], TODAY, NOW).map(() => archived));
    assert.deepEqual(holdBoardForDay([archived], TODAY, NOW), holdBoardForDay([live], TODAY, NOW).map(() => archived));
  }
});

test("assembled from the loader: archived call plus requests archived with it all stay on the sheets", () => {
  const items = assembleInboxItems({
    leads: [lead(CALL, "archived")],
    holds: [hold("h-1", CALL, { inbox_archived_at: STAMP }), hold("h-2", CALL, { inbox_archived_at: STAMP })],
    jobs: [job("v-1", CALL, { inbox_archived_at: STAMP })],
  });
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => itemIsArchived(i)), "nothing left in the inbox");
  const holdIds = holdBoardForDay(items, TODAY, NOW).map((i) => i.hold?.id).sort();
  assert.deepEqual(holdIds, ["h-1", "h-2"], "both holds on Holds Today");
  const visitIds = visitBoardForDay(items, TODAY, NOW).map((i) => i.job?.id);
  assert.deepEqual(visitIds, ["v-1"], "visit on Visits Today and Home today");
});

test("sheets and Home today read no archive state; only the inbox does", () => {
  for (const f of ["lib/runSheet.ts", "lib/holdSheet.ts"]) {
    assert.doesNotMatch(src(f), /IsArchived|inbox_archived_at|leadStatus/, f);
  }
  const home = src("app/(desk)/home/page.tsx");
  assert.match(home, /visitBoardForDay\(inbox\.items, eatYmd\(\)\)/, "Home today reads every loaded item");
  assert.doesNotMatch(src("lib/inboxPurpose.ts"), /itemCallIsArchived/);
});
