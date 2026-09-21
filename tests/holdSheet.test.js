const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { visitDayKey, eatYmd } = require("../src/conversation/visitCalendar");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function isHoldBoardItem(item) {
  if (!item?.hold) return false;
  return String(item.hold.status || "").toLowerCase() === "open";
}

describe("desk hold board", () => {
  const now = new Date(Date.UTC(2026, 8, 17, 8, 0, 0));

  it("keeps only open holds on the board", () => {
    assert.equal(isHoldBoardItem({ hold: { status: "open" } }), true);
    assert.equal(isHoldBoardItem({ hold: { status: "fulfilled" } }), false);
    assert.equal(isHoldBoardItem({ hold: { status: "cancelled" } }), false);
    assert.equal(isHoldBoardItem({}), false);
  });

  it("places a pickup today on this EAT day and leaves Anytime off the day", () => {
    assert.equal(visitDayKey({ when_text: "today at 6 PM" }, now), eatYmd(now));
    assert.equal(visitDayKey({ when_text: "Anytime" }, now), null);
    assert.equal(visitDayKey({ when_text: "" }, now), null);
  });

  it("wires Holds List as the open book and Work as timed pickups", () => {
    const sheet = read("dashboard/src/lib/holdSheet.ts");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
    const today = read("dashboard/src/components/RunSheetToday.tsx");
    assert.match(sheet, /export function holdBoardForDay/);
    assert.match(sheet, /export function holdBoardItems/);
    assert.match(sheet, /export function holdWorkItems/);
    assert.match(sheet, /holdWorkItems\(items, now\)/);
    assert.doesNotMatch(sheet, /weekDays/);
    assert.match(page, /holdBoardForDay/);
    assert.match(page, /purpose="hold"/);
    assert.match(toolbar, /label="Hold sort"/);
    assert.match(toolbar, /purpose: "hold"/);
    assert.match(today, /purpose === "hold"/);
    assert.match(today, /RequestStatusToggle/);
    const holdBlock = toolbar.slice(
      toolbar.indexOf('label="Hold sort"'),
      toolbar.indexOf('label="Work date"')
    );
    assert.match(holdBlock, /label: "Work"/);
    assert.doesNotMatch(holdBlock, /label: "Week"/);
  });

  it("pins timed holds from a past day at the top of List", () => {
    const now = new Date(Date.UTC(2026, 8, 19, 5, 0, 0));
    assert.equal(visitDayKey({ when_text: "tomorrow at 6 PM" }, now) < eatYmd(now), false);
    assert.equal(visitDayKey({ when_text: "Anytime" }, now), null);
    const sheet = read("dashboard/src/lib/holdSheet.ts");
    const nav = read("dashboard/src/components/InboxPileNav.tsx");
    assert.match(sheet, /export function isHoldListLeftover/);
    assert.match(sheet, /eatYmd\(instant\) < eatYmd\(now\)/);
    assert.match(sheet, /export function orderHoldList/);
    assert.match(nav, /orderHoldList\(ordered\)/);
  });
});
