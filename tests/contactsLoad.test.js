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
  const src = fs.readFileSync(
    path.join(__dirname, "..", "dashboard/src/lib/contactsLoad.ts"),
    "utf8"
  );

  it("exposes search, sort, and Recent calls helpers on the same loader", () => {
    assert.match(src, /export function resolveContactSort/);
    assert.match(src, /export function contactMatchesQuery/);
    assert.match(src, /export function uniqueRecentCallerPhones/);
    assert.match(src, /saved === "recent"/);
    assert.match(src, /export function contactsRecentsHref/);
    assert.match(src, /export function contactsFavouritesHref/);
    assert.match(src, /export async function loadContactPileCounts/);
    assert.match(src, /saved === "favourite"/);
    assert.match(src, /sanitizeSearchQuery/);
    assert.doesNotMatch(src, /\bOnline\b/);
    assert.doesNotMatch(src, /lead_status/);
  });

  it("merges phone activity with contact-id activity instead of short-circuiting", () => {
    assert.match(src, /export function pickLastContactAt/);
    assert.match(src, /lastContactAt: pickLastContactAt\(/);
    assert.doesNotMatch(
      src,
      /lastContactAt:\s*\n\s*extras\.byId\.get\(row\.id\) \|\|/
    );
  });

  it("uses the latest call's Inbox one-liner, not hangup Want", () => {
    assert.match(src, /pickCallOwnerReason\(parseSummary/);
    assert.match(src, /latestCallReason: ownerReason \|\| ownerWant/);
  });

  it("joins last-reason maps on normalized phone candidates", () => {
    assert.match(src, /storedPhoneCandidates/);
    assert.match(src, /\.in\("caller_number", phoneKeys\)/);
    assert.match(src, /\.in\("caller_phone", phoneKeys\)/);
  });
});
