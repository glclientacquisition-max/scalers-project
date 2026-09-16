const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function pickLastContactAt(byPhone, byContactId, updatedAt) {
  return maxIso(byPhone || null, byContactId || null) || updatedAt || null;
}

describe("pickLastContactAt", () => {
  it("lets a later call beat an earlier visit created_at", () => {
    assert.equal(
      pickLastContactAt(
        "2026-09-16T15:36:22.322Z",
        "2026-09-16T05:14:11.421Z",
        "2026-09-16T15:39:28.548Z"
      ),
      "2026-09-16T15:36:22.322Z"
    );
  });

  it("falls back to contact updated_at when there is no call or work", () => {
    assert.equal(
      pickLastContactAt(null, null, "2026-09-16T15:39:28.548Z"),
      "2026-09-16T15:39:28.548Z"
    );
  });
});

describe("contactsLoad last-contact wiring", () => {
  it("merges phone activity with contact-id activity instead of short-circuiting", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "dashboard/src/lib/contactsLoad.ts"),
      "utf8"
    );
    assert.match(src, /export function pickLastContactAt/);
    assert.match(src, /lastContactAt: pickLastContactAt\(/);
    assert.doesNotMatch(
      src,
      /lastContactAt:\s*\n\s*extras\.byId\.get\(row\.id\) \|\|/
    );
  });
});
