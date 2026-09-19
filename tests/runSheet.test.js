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

function isVisitWorkJob(job) {
  return String(job?.status || "").toLowerCase() === "confirmed";
}

describe("desk visit board", () => {
  const now = new Date(Date.UTC(2026, 8, 17, 8, 0, 0));

  it("keeps requested and confirmed visits on List, confirmed only on Work", () => {
    assert.equal(isVisitBoardJob({ status: "requested" }), true);
    assert.equal(isVisitBoardJob({ status: "confirmed" }), true);
    assert.equal(isVisitBoardJob({ status: "done" }), false);
    assert.equal(isVisitBoardJob({ status: "cancelled" }), false);
    assert.equal(isVisitBoardJob(null), false);
    assert.equal(isVisitWorkJob({ status: "requested" }), false);
    assert.equal(isVisitWorkJob({ status: "confirmed" }), true);
    assert.equal(isVisitWorkJob({ status: "done" }), false);
  });

  it("places a tomorrow slot on the next EAT day", () => {
    const key = visitDayKey({ when_text: "tomorrow at 4 PM" }, now);
    assert.equal(key, eatYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000)));
    assert.notEqual(key, eatYmd(now));
  });

  it("wires List as newest table and Work as dated diary", () => {
    const sheet = read("dashboard/src/lib/runSheet.ts");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
    const week = read("dashboard/src/components/VisitWeekCalendar.tsx");
    const today = read("dashboard/src/components/RunSheetToday.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    assert.match(sheet, /status === "requested" \|\| status === "confirmed"/);
    assert.match(sheet, /export function visitWorkItems/);
    assert.match(sheet, /export function visitBoardForDay/);
    assert.match(sheet, /export function visitBoardItems/);
    assert.match(sheet, /export function groupVisitBoardForWeek/);
    assert.match(sheet, /visitWorkItems\(items\)/);
    assert.doesNotMatch(sheet, /hold_or_pickup/);
    assert.match(page, /visitBoardItems/);
    assert.match(page, /visitBoardForDay/);
    assert.match(page, /RunSheetToday/);
    assert.match(page, /VisitWeekCalendar/);
    assert.match(toolbar, /label: "Work"/);
    assert.match(toolbar, /label: "Today"/);
    assert.match(toolbar, /view: "today"/);
    assert.match(toolbar, /label="Work date"/);
    assert.match(week, /groupVisitBoardForWeek/);
    assert.doesNotMatch(week, /RequestStatusToggle/);
    assert.match(week, /md:hidden/);
    assert.match(week, /md:grid md:grid-cols-7/);
    assert.match(today, /todayEmpty/);
    assert.match(today, /dayHeading/);
    assert.match(today, /InboxJobActions/);
    assert.match(today, /RequestStatusToggle/);
    assert.match(home, /visitBoardForDay/);
    assert.match(home, /ctaLabel = "Today"/);
    assert.equal(mondayYmd(now).startsWith("2026-09"), true);
  });

  it("pins confirmed visits from last week at the top of List", () => {
    const now = new Date(Date.UTC(2026, 8, 19, 5, 0, 0));
    assert.equal(mondayYmd(now), "2026-09-14");
    assert.equal(eatYmd(new Date("2026-09-10T10:00:00+03:00")) < mondayYmd(now), true);
    assert.equal(eatYmd(new Date("2026-09-15T10:00:00+03:00")) < mondayYmd(now), false);
    const sheet = read("dashboard/src/lib/runSheet.ts");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    assert.match(sheet, /export function isVisitListLeftover/);
    assert.match(sheet, /eatYmd\(instant\) < mondayYmd\(now\)/);
    assert.match(sheet, /export function orderVisitList/);
    assert.match(page, /orderVisitList\(filtered\)/);
  });
});
