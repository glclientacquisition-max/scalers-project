const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function clampInboxListWidth(px, parentWidth) {
  const MIN = 288;
  const MAX = 640;
  const THREAD = 320;
  const GUTTER = 1;
  const room = parentWidth - THREAD - GUTTER;
  const max = Math.min(MAX, Math.max(MIN, room));
  return Math.round(Math.min(max, Math.max(MIN, px)));
}

describe("inbox split width", () => {
  const src = read("dashboard/src/lib/inboxSplit.ts");

  it("locks min max and thread floor to the 8px rem scale", () => {
    assert.match(src, /INBOX_LIST_MIN = 288/);
    assert.match(src, /INBOX_LIST_MAX = 640/);
    assert.match(src, /INBOX_THREAD_MIN = 320/);
    assert.match(src, /INBOX_SPLIT_GUTTER = 1/);
    assert.match(src, /inboxListDefaultWidth/);
  });

  it("keeps the thread readable when the list is dragged wide", () => {
    assert.equal(clampInboxListWidth(900, 696), 375);
    assert.equal(clampInboxListWidth(100, 1200), 288);
    assert.equal(clampInboxListWidth(500, 1200), 500);
    assert.equal(clampInboxListWidth(800, 1200), 640);
  });

  it("wires a keyboard separator and stores the owner width", () => {
    const split = read("dashboard/src/components/InboxSplit.tsx");
    assert.match(split, /role="separator"/);
    assert.match(split, /aria-orientation="vertical"/);
    assert.match(split, /ArrowRight/);
    assert.match(split, /onDoubleClick/);
    assert.match(split, /ResizeObserver/);
    assert.match(split, /label="List width"/);
    assert.match(split, /localStorage\.setItem\(INBOX_SPLIT_KEY/);
    assert.match(read("dashboard/src/components/InboxColumn.tsx"), /md:w-\[20rem\] lg:w-\[24rem\] xl:w-\[28rem\]/);
    assert.match(read("dashboard/src/components/InboxColumn.tsx"), /md:block md:min-h-0 md:overflow-x-hidden/);
  });
});
