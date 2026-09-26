const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("wallet runway", () => {
  const wallet = read("dashboard/src/lib/wallet.ts");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");

  it("keeps one runway math shared by Wallet and Home", () => {
    assert.match(wallet, /export function runwayDaysAtPace/);
    assert.match(wallet, /runwayDaysAtPace\(\{\s*minutesThisMonth,\s*dayOfMonth,\s*balanceKes: walletBalanceKes/);
    assert.match(wallet, /export async function getWalletRunwayDays/);
  });

  it("reads only call durations for the light Home query", () => {
    assert.match(wallet, /select\("duration_seconds, ai_processing_minutes"\)/);
    const loader = wallet.slice(
      wallet.indexOf("export async function getWalletRunwayDays"),
      wallet.indexOf("export function walletRunwayLabel")
    );
    assert.ok(loader.length > 0);
    assert.doesNotMatch(loader, /wallet_ledger/);
  });

  it("shows the caption only when it is decision-useful", () => {
    assert.match(wallet, /days == null \|\| days <= 0 \|\| days > 90/);
    assert.match(wallet, /at this pace/);
  });

  it("keeps one beta rule for every surface", () => {
    assert.match(wallet, /export function isBetaBilling/);
    assert.match(wallet, /const isBeta = isBetaBilling\(billingEnforcement\)/);
  });

  it("keeps prepaid runway math on the wallet helper only", () => {
    assert.match(home, /isBetaBilling\(tenant\.billing_enforcement\)/);
    assert.doesNotMatch(home, /getWalletRunwayDays/);
    assert.doesNotMatch(home, /walletRunwayLabel/);
    assert.doesNotMatch(home, /lowWallet/);
  });

  it("renders remaining minutes on Home from the package meter", () => {
    assert.match(home, /loadOwnerPackageMeter\(tenant\.id\)/);
    assert.match(home, /remainingCount\(pack\.minutesIncluded, pack\.minutesUsed\)/);
    assert.match(home, /min left/);
    assert.match(home, /aria-label="Usage"/);
  });

  it("renders the owner ledger as a dense table", () => {
    const page = read("dashboard/src/app/(desk)/wallet/page.tsx");
    assert.match(page, /recentLedger\.map/);
    assert.match(page, /<Pagination/);
    assert.match(read("dashboard/src/lib/wallet.ts"), /count: "exact"/);
    assert.match(page, /<table className="mt-2 w-full text-left text-sm">/);
    assert.match(page, /px-4 py-2/);
    assert.doesNotMatch(page, /divide-y divide-line/);
    assert.doesNotMatch(page, /getWalletLedger|rpc\(/);
  });
});
