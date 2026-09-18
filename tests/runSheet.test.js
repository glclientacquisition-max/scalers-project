const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { visitDayKey, eatYmd, mondayYmd } = require("../src/conversation/visitCalendar");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function isVisitBoardJob(job) {
  if (!job) return false;
  const status = String(job.status || "").toLowerCase();
  return status === "requested" || status === "confirmed";
}

describe("desk visit board", () => {
  const now = new Date(Date.UTC(2026, 8, 17, 8, 0, 0));

  it("keeps requested and confirmed visits on the board", () => {
    assert.equal(isVisitBoardJob({ status: "requested" }), true);
    assert.equal(isVisitBoardJob({ status: "confirmed" }), true);
    assert.equal(isVisitBoardJob({ status: "done" }), false);
    assert.equal(isVisitBoardJob({ status: "cancelled" }), false);
    assert.equal(isVisitBoardJob(null), false);
  });

  it("places a tomorrow slot on the next EAT day", () => {
    const key = visitDayKey({ when_text: "tomorrow at 4 PM" }, now);
    assert.equal(key, eatYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000)));
    assert.notEqual(key, eatYmd(now));
  });

  it("wires List Today Week as one Visits table", () => {
    const sheet = read("dashboard/src/lib/runSheet.ts");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    assert.match(sheet, /status === "requested" \|\| status === "confirmed"/);
    assert.match(sheet, /export function visitBoardForDay/);
    assert.match(sheet, /export function visitBoardForWeek/);
    assert.match(sheet, /export function visitBoardItems/);
    assert.doesNotMatch(sheet, /hold_or_pickup/);
    assert.match(page, /visitBoardForDay/);
    assert.match(page, /visitBoardForWeek/);
    assert.match(page, /InboxPhoneRow/);
    assert.match(page, /InboxTableRow/);
    assert.doesNotMatch(page, /RunSheetToday/);
    assert.doesNotMatch(page, /VisitWeekCalendar/);
    assert.match(toolbar, /label="Visit filter"/);
    assert.match(toolbar, /label: "Today"/);
    assert.match(toolbar, /view: "today"/);
    assert.doesNotMatch(toolbar, /day,/);
    assert.match(home, /visitBoardForDay/);
    assert.match(home, /ctaLabel = "Today"/);
    assert.equal(mondayYmd(now).startsWith("2026-09"), true);
  });
});
