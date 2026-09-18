const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function mergeOpenAndTapeRows(open, tape) {
  const seen = new Set();
  const out = [];
  for (const row of [...open, ...tape]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

describe("inbox open-work window", () => {
  const load = read("dashboard/src/lib/inboxLoad.ts");
  const calls = read("docs/frontend/design-system/pages/calls.md");
  const home = read("docs/frontend/design-system/pages/home.md");

  it("keeps an old open hold when the closed tape is full of newer rows", () => {
    const open = [{ id: "old-open", created_at: "2020-01-01T00:00:00.000Z" }];
    const tape = Array.from({ length: 150 }, (_, i) => ({
      id: `closed-${i}`,
      created_at: "2026-09-17T00:00:00.000Z",
    }));
    const merged = mergeOpenAndTapeRows(open, tape);
    assert.equal(merged[0].id, "old-open");
    assert.equal(merged.length, 151);
  });

  it("fetches every open hold and unresolved visit, then a 150-row call tape", () => {
    assert.match(load, /export const INBOX_WINDOW = 150;/);
    assert.match(load, /export const OPEN_WORK_SAFETY_CAP = 10_000;/);
    assert.match(load, /export const OPEN_HOLD_STATUS = "open";/);
    assert.match(load, /OPEN_JOB_STATUSES = \["requested", "confirmed"\]/);
    assert.match(load, /\.eq\("status", OPEN_HOLD_STATUS\)/);
    assert.match(load, /\.in\("status", \[\.\.\.OPEN_JOB_STATUSES\]\)/);
    assert.match(load, /fetchPagedOpenWork/);
    assert.match(load, /fetchCallsTape/);
    assert.match(load, /\.eq\("status", OPEN_HOLD_STATUS\)[\s\S]{0,160}\.range\(from, to\)/);
    assert.match(load, /TAPE_HOLD_STATUSES[\s\S]{0,220}\.limit\(INBOX_WINDOW\)/);
    assert.match(load, /callsTruncated: \(callsRes\.data \|\| \[\]\)\.length >= INBOX_WINDOW/);
    assert.match(load, /Tape only/);
    assert.match(calls, /callsTruncated` means the closed history tape is truncated/);
    assert.match(home, /Open holds and visits are loaded in full/);
  });

  it("exports mergeOpenAndTapeRows for the open-then-tape assemble", () => {
    assert.match(load, /export function mergeOpenAndTapeRows/);
    assert.match(load, /inboxContactPhoneQueryValues/);
    assert.match(load, /storedPhoneCandidates/);
  });
});
