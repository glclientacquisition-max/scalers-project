const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function clampTicketSummaryWidth(px, parentWidth) {
  const MIN = 288;
  const MAX = 512;
  const THREAD = 320;
  const GUTTER = 1;
  const room = parentWidth - THREAD - GUTTER;
  const max = Math.min(MAX, Math.max(MIN, room));
  return Math.round(Math.min(max, Math.max(MIN, px)));
}

describe("ticket split width", () => {
  const src = read("dashboard/src/lib/ticketSplit.ts");

  it("locks min default max and thread floor to the shipped 18/22rem grid", () => {
    assert.match(src, /TICKET_SUMMARY_MIN = 288/);
    assert.match(src, /TICKET_SUMMARY_DEFAULT = 352/);
    assert.match(src, /TICKET_SUMMARY_MAX = 512/);
    assert.match(src, /TICKET_THREAD_MIN = 320/);
    assert.match(src, /TICKET_SPLIT_GUTTER = 1/);
  });

  it("keeps the transcript readable when the summary is dragged wide", () => {
    assert.equal(clampTicketSummaryWidth(900, 1024), 512);
    assert.equal(clampTicketSummaryWidth(100, 1200), 288);
    assert.equal(clampTicketSummaryWidth(400, 1200), 400);
    assert.equal(clampTicketSummaryWidth(900, 600), 288);
  });

  it("wires a keyboard separator on the ticket without replacing the list", () => {
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    assert.match(ticket, /role="separator"/);
    assert.match(ticket, /aria-orientation="vertical"/);
    assert.match(ticket, /ArrowRight/);
    assert.match(ticket, /onDoubleClick/);
    assert.match(ticket, /ResizeObserver/);
    assert.match(ticket, /label="Summary width"/);
    assert.match(ticket, /localStorage\.setItem\(TICKET_SPLIT_KEY/);
    assert.doesNotMatch(ticket, /InboxSplit/);
    assert.doesNotMatch(ticket, /DeskRail/);
  });
});
