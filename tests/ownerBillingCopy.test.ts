/**
 * Owner Plan, Billing, and Usage screens stay on included, used, left, plan price, and invoice amounts.
 * Run: node --experimental-strip-types --test tests/ownerBillingCopy.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const OWNER_SCREENS = [
  "dashboard/src/app/(desk)/wallet/page.tsx",
  "dashboard/src/app/(desk)/settings/plan/page.tsx",
  "dashboard/src/app/(desk)/settings/billing/page.tsx",
  "dashboard/src/components/plan/PlanPicker.tsx",
  "dashboard/src/components/plan/UsageSummary.tsx",
  "dashboard/src/components/plan/OwnerInvoiceList.tsx",
  "dashboard/src/components/OnDemandUsagePanel.tsx",
  "dashboard/src/components/DeskBillingBanner.tsx",
  "dashboard/src/app/dev/billing/BillingFixture.tsx",
  "dashboard/src/lib/billingBanner.ts",
  "dashboard/src/lib/invoicePayState.ts",
];

const BANNED = [
  /1 credit is/,
  /a credit/,
  /KSh 1 each/,
  /ex VAT/,
  /Pay link coming/,
  /Suggested until you set one/,
  /Inbox only/,
  /at the rates below/,
  /sending stops/,
];

describe("owner billing copy", () => {
  it("does not render a per-credit price or standing rate table", () => {
    for (const rel of OWNER_SCREENS) {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      for (const pattern of BANNED) {
        assert.doesNotMatch(text, pattern, `${rel} matches ${pattern}`);
      }
    }
  });

  it("does not say SMS on Usage", () => {
    for (const rel of [
      "dashboard/src/app/(desk)/wallet/page.tsx",
      "dashboard/src/components/plan/UsageSummary.tsx",
      "dashboard/src/components/OnDemandUsagePanel.tsx",
      "dashboard/src/app/dev/billing/BillingFixture.tsx",
    ]) {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      assert.doesNotMatch(text, /\bSMS\b/, rel);
    }
  });

  it("links Usage to Plan and keeps Plan active in the settings rail", () => {
    const usage = fs.readFileSync(path.join(root, "dashboard/src/components/plan/UsageSummary.tsx"), "utf8");
    const frame = fs.readFileSync(path.join(root, "dashboard/src/components/plan/SettingsPlanFrame.tsx"), "utf8");
    const wallet = fs.readFileSync(path.join(root, "dashboard/src/app/(desk)/wallet/page.tsx"), "utf8");
    assert.match(usage, /Change plan/);
    assert.match(usage, /href="\/settings\/plan"/);
    assert.match(wallet, /showChangePlan/);
    assert.match(frame, /SettingsRail/);
    assert.match(frame, /data-desk-nested/);
  });
});
