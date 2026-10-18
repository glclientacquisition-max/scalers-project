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
  "dashboard/src/lib/billingHistory.ts",
  "dashboard/src/components/plan/BillingHistory.tsx",
  "dashboard/src/lib/ownerPlanLoad.ts",
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
  /credit_kes/,
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
    assert.match(wallet, /showChangePlan=\{canChangePlan && !extras\.freeBeta\}/);
    const picker = fs.readFileSync(path.join(root, "dashboard/src/components/plan/PlanPicker.tsx"), "utf8");
    const fixture = fs.readFileSync(path.join(root, "dashboard/src/app/dev/billing/BillingFixture.tsx"), "utf8");
    assert.match(picker, /useState<PlanSku \| null>\(startConfirm \? upgradeSku : null\)/);
    assert.match(picker, /const selected = picked && !showCurrent/);
    assert.match(picker, /Extra seats: \{model\.extraSeats\}/);
    assert.match(picker, /setExtraSeatsAction/);
    assert.doesNotMatch(picker, /EXTRA_SEAT_MONTHLY_KES/);
    const members = fs.readFileSync(path.join(root, "dashboard/src/components/MembersPanel.tsx"), "utf8");
    assert.match(members, /Add a seat, \$\{formatKsh\(seatPrice\)\} a month/);
    assert.match(members, /seatIncreaseCopy/);
    assert.match(members, /variant="tonal"/);
    assert.match(members, /block/);
    assert.doesNotMatch(members, /for the rest of this period/);
    assert.match(picker, /seatIncreaseCopy/);
    assert.match(picker, /seatReductionCopy/);
    assert.match(picker, /className="w-full"/);
    assert.doesNotMatch(picker, /for the rest of this period/);
    assert.doesNotMatch(picker, /Takes effect on the next bill/);
    assert.match(members, /setExtraSeatsAction/);
    assert.doesNotMatch(members, /Upgrade your package/);
    assert.doesNotMatch(members, /upgrade instead/i);
    assert.match(picker, /selected \? "border-accent bg-accent-tonal" : "border-hairline bg-surface"/);
    assert.match(fixture, /showChangePlan=\{!beta\}/);
    assert.match(frame, /SettingsRail/);
    assert.match(frame, /data-desk-nested/);
  });
});
