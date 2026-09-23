const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

function groupContactTimeline(entries, windowMs = 15 * 60 * 1000) {
  const rows = [];
  let open = [];
  function flush() {
    if (!open.length) return;
    if (open.length === 1) rows.push({ kind: "single", entry: open[0] });
    else rows.push({ kind: "group", purpose: open[0].purpose, entries: open.slice() });
    open = [];
  }
  for (const entry of entries) {
    const prev = open[open.length - 1];
    if (
      prev &&
      prev.purpose === entry.purpose &&
      Math.abs(Date.parse(prev.createdAt) - Date.parse(entry.createdAt)) <= windowMs
    ) {
      open.push(entry);
      continue;
    }
    flush();
    open = [entry];
  }
  flush();
  return rows;
}

function contactHistoryInsight(entries) {
  const total = entries.length;
  if (total < 8) return null;
  const missed = entries.filter((entry) => entry.purpose === "missed").length;
  if (missed / total < 0.55) return null;
  return `${missed} of ${total} interactions are missed. Same-day retries may need a callback.`;
}

function pageContactHistory(rows, shown) {
  return rows.slice(0, Math.max(12, shown));
}

describe("contact history grouping", () => {
  it("groups consecutive missed calls and never swallows a different type", () => {
    const rows = groupContactTimeline([
      { id: "1", purpose: "missed", createdAt: "2026-09-22T20:00:00.000Z" },
      { id: "2", purpose: "missed", createdAt: "2026-09-22T19:58:00.000Z" },
      { id: "3", purpose: "human", createdAt: "2026-09-22T19:50:00.000Z" },
      { id: "4", purpose: "missed", createdAt: "2026-09-22T19:48:00.000Z" },
    ]);
    assert.equal(rows[0].kind, "group");
    assert.equal(rows[0].entries.length, 2);
    assert.equal(rows[1].kind, "single");
    assert.equal(rows[1].entry.purpose, "human");
    assert.equal(rows[2].kind, "single");
    assert.equal(rows[2].entry.purpose, "missed");
  });

  it("omits insight until the missed ratio is real", () => {
    assert.equal(
      contactHistoryInsight([
        { purpose: "missed" },
        { purpose: "answered" },
        { purpose: "missed" },
      ]),
      null
    );
    const many = Array.from({ length: 8 }, (_, i) => ({
      purpose: i < 6 ? "missed" : "answered",
    }));
    assert.match(contactHistoryInsight(many), /6 of 8 interactions are missed/);
  });
});

describe("contact history view more", () => {
  it("pages History instead of dumping every row", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    assert.deepEqual(pageContactHistory(rows, 12), rows.slice(0, 12));
    assert.deepEqual(pageContactHistory(rows, 24), rows.slice(0, 24));
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "dashboard/src/components/ContactHistory.tsx"),
      "utf8"
    );
    assert.match(src, /View more/);
    assert.match(src, /data-contact-history-more/);
    assert.match(src, /pageContactHistory/);
  });
});
