/**
 * Owner wallet top-up is gone. Owner billing copy says KSh, not KES.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const OWNER_BILLING = [
  "dashboard/src/app/(desk)/settings/plan",
  "dashboard/src/app/(desk)/settings/billing",
  "dashboard/src/components/plan",
  "dashboard/src/components/DeskBillingBanner.tsx",
  "dashboard/src/lib/billingStateModel.ts",
  "dashboard/src/lib/billingBanner.ts",
  "dashboard/src/lib/invoicePayState.ts",
  "dashboard/src/lib/planPricing.ts",
  "dashboard/src/lib/wallet.ts",
  "dashboard/src/lib/usageCap.ts",
  "dashboard/src/app/(desk)/wallet/page.tsx",
  "dashboard/src/components/OnDemandUsagePanel.tsx",
  "dashboard/src/components/marketing/PackagePrices.tsx",
];

describe("wallet top-up retired", () => {
  it("has no top-up module and no import of it", () => {
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/components/WalletTopUpButton.tsx")), false);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/lib/walletTopUp.ts")), false);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/app/(desk)/wallet/topupActions.ts")), false);
    const files = walk(path.join(root, "dashboard/src"));
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, /WalletTopUpButton|walletTopUp|initiateWalletTopUp/);
    }
  });

  it("keeps Pay KES and KES out of owner billing copy", () => {
    const files = [];
    for (const rel of OWNER_BILLING) {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) files.push(...walk(full));
      else files.push(full);
    }
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, /Pay KES/, path.relative(root, file));
      assert.doesNotMatch(text, /(?<![A-Za-z_])KES /, path.relative(root, file));
    }
  });
});
