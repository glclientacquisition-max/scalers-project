const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { visitDayKey, eatYmd, mondayYmd } = require("../src/conversation/visitCalendar");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const HOLD_OR_ORDER = new Set(["hold_or_pickup", "hold", "order_enquiry", "order"]);

function isRunSheetJob(job) {
  return Boolean(job && String(job.status || "").toLowerCase() === "confirmed");
}

function isHoldOrOrder(hold) {
  const key = String(hold.request_type || "").toLowerCase();
  return HOLD_OR_ORDER.has(key);
}

function isRunSheetHold(hold, now) {
  if (!hold || String(hold.status || "").toLowerCase() !== "open") return false;
  if (!isHoldOrOrder(hold)) return false;
  return Boolean(visitDayKey({ when_text: hold.when_text, status: hold.status }, now));
}

describe("desk run sheet", () => {
  const now = new Date(Date.UTC(2026, 8, 17, 8, 0, 0));

  it("keeps requested visits off the board and confirmed on it", () => {
    assert.equal(isRunSheetJob({ status: "requested" }), false);
    assert.equal(isRunSheetJob({ status: "done" }), false);
    assert.equal(isRunSheetJob({ status: "cancelled" }), false);
    assert.equal(isRunSheetJob({ status: "confirmed" }), true);
  });

  it("puts timed open holds and orders on the board, not callbacks", () => {
    assert.equal(
      isRunSheetHold(
        { status: "open", request_type: "hold", when_text: "tomorrow at 4 PM" },
        now
      ),
      true
    );
    assert.equal(
      isRunSheetHold(
        { status: "open", request_type: "order", when_text: "today 10 AM" },
        now
      ),
      true
    );
    assert.equal(
      isRunSheetHold(
        { status: "open", request_type: "callback", when_text: "tomorrow at 4 PM" },
        now
      ),
      false
    );
    assert.equal(
      isRunSheetHold({ status: "open", request_type: "hold", when_text: "" }, now),
      false
    );
    assert.equal(
      isRunSheetHold(
        { status: "fulfilled", request_type: "hold", when_text: "tomorrow at 4 PM" },
        now
      ),
      false
    );
  });

  it("places a tomorrow hold on the next EAT day", () => {
    const key = visitDayKey({ when_text: "tomorrow at 4 PM" }, now);
    assert.equal(key, eatYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000)));
    assert.notEqual(key, eatYmd(now));
  });

  it("wires Today and confirmed Week into Inbox Visits", () => {
    const sheet = read("dashboard/src/lib/runSheet.ts");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
    const week = read("dashboard/src/components/VisitWeekCalendar.tsx");
    const today = read("dashboard/src/components/RunSheetToday.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    assert.match(sheet, /=== "confirmed"/);
    assert.match(sheet, /hold_or_pickup/);
    assert.match(sheet, /runSheetForDay/);
    assert.match(page, /view === "today"/);
    assert.match(page, /RunSheetToday/);
    assert.match(page, /runSheetItems/);
    assert.match(toolbar, /label: "Today"/);
    assert.match(toolbar, /view: "today"/);
    assert.match(week, /groupRunSheetForWeek/);
    assert.match(week, /RequestStatusToggle/);
    assert.match(today, /todayEmpty/);
    assert.match(home, /view: "today"/);
    assert.match(home, /ctaLabel = "Today"/);
    assert.equal(mondayYmd(now).startsWith("2026-09"), true);
  });
});
