const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("owner usage surface", () => {
  const wallet = read("dashboard/src/lib/wallet.ts");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");

  it("keeps one beta rule for every surface", () => {
    assert.match(wallet, /export function isBetaBilling/);
    assert.match(wallet, /const isBeta = isBetaBilling\(billingEnforcement\)/);
  });

  it("keeps wallet balance math off Home", () => {
    assert.match(home, /isBetaBilling\(tenant\.billing_enforcement\)/);
    assert.doesNotMatch(home, /getWalletRunwayDays/);
    assert.doesNotMatch(home, /walletRunwayLabel/);
    assert.doesNotMatch(home, /lowWallet/);
  });

  it("keeps balance and runway helpers out of the wallet lib", () => {
    assert.doesNotMatch(wallet, /runwayDaysAtPace|getWalletRunwayDays|walletRunwayLabel/);
    assert.doesNotMatch(wallet, /resolveWalletBalanceKes|WALLET_LOW_BALANCE_KES/);
    assert.doesNotMatch(wallet, /ensureLineRentalApplied|apply_line_rental/);
  });

  it("renders remaining minutes on Home from the package meter", () => {
    assert.match(home, /loadOwnerPackageMeter\(tenant\.id\)/);
    assert.match(home, /remainingCount\(pack\.minutesIncluded, pack\.minutesUsed\)/);
    assert.match(home, /min left/);
    assert.match(home, /aria-label="Usage"/);
  });

  it("renders the owner charge lines as a dense table", () => {
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
