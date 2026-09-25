const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  isLiveTransferSummary,
  splitCallMinutes,
  estimatedCallCostKes,
  runwayDaysAtPace,
} = require("../dashboard/src/lib/walletMath.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("usage meter math", () => {
  it("treats only outbound live-transfer legs as transfer", () => {
    assert.equal(
      isLiveTransferSummary({ kind: "live_transfer", direction: "outbound" }),
      true
    );
    assert.equal(
      isLiveTransferSummary(
        JSON.stringify({ kind: "live_transfer", direction: "outbound" })
      ),
      true
    );
    assert.equal(
      isLiveTransferSummary({ kind: "live_transfer", direction: "inbound" }),
      false
    );
    assert.equal(isLiveTransferSummary({ text: "hello" }), false);
    assert.equal(isLiveTransferSummary(null), false);
  });

  it("splits inbound and transfer minutes from duration or AI minutes", () => {
    const split = splitCallMinutes([
      { duration_seconds: 120, ai_processing_minutes: null, summary: null },
      {
        duration_seconds: 90,
        ai_processing_minutes: 1.5,
        summary: { kind: "live_transfer", direction: "outbound" },
      },
      { duration_seconds: 60, ai_processing_minutes: null },
    ]);
    assert.equal(split.inboundMinutes, 3);
    assert.equal(split.transferMinutes, 1.5);
    assert.equal(split.minutes, 4.5);
    assert.equal(split.inboundSeconds, 180);
    assert.equal(split.transferSeconds, 90);
  });

  it("prices inbound and transfer on the rate card", () => {
    // 12 inbound at KES 0 + 5 transfer at KES 4 = 20
    assert.equal(estimatedCallCostKes(12, 5, 0, 4), 20);
    assert.equal(estimatedCallCostKes(10, 0, 0, 4), 0);
    assert.equal(estimatedCallCostKes(10, 0, 15, 4), 150);
  });

  it("uses spent pace when given, else minutes times inbound rate", () => {
    assert.equal(
      runwayDaysAtPace({
        minutesThisMonth: 30,
        dayOfMonth: 10,
        balanceKes: 120,
        inboundRate: 0,
      }),
      null
    );
    assert.equal(
      runwayDaysAtPace({
        minutesThisMonth: 30,
        dayOfMonth: 10,
        balanceKes: 120,
        spentKesThisMonth: 40,
      }),
      30
    );
    assert.equal(
      runwayDaysAtPace({
        minutesThisMonth: 30,
        dayOfMonth: 10,
        balanceKes: 150,
        inboundRate: 5,
      }),
      10
    );
  });
});

describe("usage page wiring", () => {
  const wallet = read("dashboard/src/lib/wallet.ts");
  const page = read("dashboard/src/app/(desk)/wallet/page.tsx");

  it("loads call summary so Usage can split transfer legs", () => {
    const start = wallet.indexOf("export async function getTenantUsageSummary");
    const loader = wallet.slice(start, wallet.indexOf("return {", start));
    assert.match(loader, /splitCallMinutes/);
    assert.match(loader, /estimatedCallCostKes/);
    assert.match(
      loader,
      /select\("duration_seconds, ai_processing_minutes, summary"\)/
    );
  });

  it("shows runway on Usage and keeps the ledger as one phone-or-table dataset", () => {
    assert.match(page, /walletRunwayLabel/);
    assert.match(page, /md:hidden/);
    assert.match(page, /hidden md:block/);
    assert.match(page, /inboxRecordHref/);
    assert.match(page, /deskPreviewClass/);
    assert.doesNotMatch(page, /overflow-wrap:anywhere/);
  });
});
