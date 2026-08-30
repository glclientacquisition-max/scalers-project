const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

/**
 * Home Command Center invariants. Keep in sync with
 * dashboard/src/app/(desk)/home/commandCenter.ts
 */
function lineStatusFromDid(did) {
  const value = String(did ?? "").trim();
  if (!value || /^pending:/i.test(value)) return "number_pending";
  return "line_live";
}

function firstTrainingGap(items, line) {
  return (
    items.find((item) => {
      if (!item.required || item.ok) return false;
      if (line === "number_pending" && item.id === "did") return false;
      return true;
    }) ?? null
  );
}

describe("home command center", () => {
  const commandCenter = fs.readFileSync(
    path.join(
      __dirname,
      "../dashboard/src/app/(desk)/home/commandCenter.ts"
    ),
    "utf8"
  );
  const homePage = fs.readFileSync(
    path.join(__dirname, "../dashboard/src/app/(desk)/home/page.tsx"),
    "utf8"
  );

  it("does not invent live presence or readiness scores", () => {
    assert.doesNotMatch(homePage, /\bOnline\b/);
    assert.doesNotMatch(homePage, /AI active|Receptionist online|98%/);
    assert.doesNotMatch(homePage, /readiness\.score|\.score\b/);
    assert.match(homePage, /Line live/);
    assert.match(homePage, /Number pending/);
    assert.match(homePage, /Needs training/);
  });

  it("caps the new-lead queue and drops dead Home fetches", () => {
    assert.match(commandCenter, /HOME_LEAD_LIMIT = 8/);
    assert.doesNotMatch(homePage, /limit\(40\)/);
    assert.doesNotMatch(homePage, /countEq\("resolved"\)|countEq\("archived"\)/);
  });

  it("maps DID to Line live / Number pending", () => {
    assert.equal(lineStatusFromDid(""), "number_pending");
    assert.equal(lineStatusFromDid("pending:user-1"), "number_pending");
    assert.equal(lineStatusFromDid("PENDING:abc"), "number_pending");
    assert.equal(lineStatusFromDid("+254700000000"), "line_live");
  });

  it("skips DID as a training gap when the number is already pending", () => {
    const items = [
      { id: "did", required: true, ok: false },
      { id: "hours", required: true, ok: false },
    ];
    assert.equal(firstTrainingGap(items, "number_pending")?.id, "hours");
    assert.equal(firstTrainingGap(items, "line_live")?.id, "did");
    assert.equal(
      firstTrainingGap(
        [
          { id: "did", required: true, ok: true },
          { id: "hours", required: true, ok: true },
        ],
        "line_live"
      ),
      null
    );
  });
});
