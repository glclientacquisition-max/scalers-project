/**
 * Owner billing state mapping (tenant_billing_state → Usage copy).
 * Run: node --experimental-strip-types --no-warnings --test tests/billingStateModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  billingModeOf,
  lowBalanceNotice,
  ownerBillingView,
  periodEndLabel,
  type OwnerBillingInput,
  type TenantBillingStateRow,
} from "../dashboard/src/lib/billingStateModel.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const esgaRow: TenantBillingStateRow = {
  package_state: "active",
  package_name: "Starter",
  billing_term: "month",
  period_start: "2026-09-30T21:00:00Z",
  period_end: "2026-10-31T21:00:00Z",
  included_minutes: 300,
  used_seconds: 104 * 60 + 12,
  sms_included: 200,
  sms_used: 193,
  sms_used_source: "ledger",
  on_demand_enabled: true,
  enforcement_mode: "off",
  mode_label: "beta",
};

function input(state: TenantBillingStateRow | null, over: Partial<OwnerBillingInput> = {}): OwnerBillingInput {
  return { state, monthlyPriceKes: 4000, smsMessages: 102, seatsIncluded: 3, seatsUsed: 1, ...over };
}

describe("billingModeOf", () => {
  it("reads mode_label and treats no active package as none", () => {
    assert.equal(billingModeOf(esgaRow), "beta");
    assert.equal(billingModeOf({ ...esgaRow, mode_label: "metered" }), "metered");
    assert.equal(billingModeOf({ ...esgaRow, mode_label: "capped" }), "capped");
    assert.equal(billingModeOf({ ...esgaRow, package_state: "none" }), "none");
    assert.equal(billingModeOf(null), "none");
  });
});

describe("ownerBillingView headlines", () => {
  it("beta: free, counted, nothing charged", () => {
    const v = ownerBillingView(input(esgaRow));
    assert.equal(
      v.headline,
      "Starter · Free during beta. We count your usage so you can see it. Nothing is charged until we tell you."
    );
    assert.equal(v.ratesTitle, "Rates after beta");
  });

  it("metered uses the package price from data, never a hardcoded 5,000", () => {
    const v = ownerBillingView(input({ ...esgaRow, mode_label: "metered" }));
    assert.match(v.headline, /^Starter · KSh 4,000 a month\. Usage past what's included is billed on your next invoice/);
    assert.doesNotMatch(v.headline, /5,000/);
  });

  it("capped names the period end", () => {
    const v = ownerBillingView(input({ ...esgaRow, mode_label: "capped", on_demand_enabled: false }));
    assert.match(v.headline, /calls stop until 31 Oct unless you turn on extra usage/);
  });

  it("no package", () => {
    const v = ownerBillingView(input(null));
    assert.equal(v.headline, "No package.");
    assert.doesNotMatch(v.headline, /invoice/);
  });

  it("free beta with no package does not show a charge or an invoice", () => {
    const v = ownerBillingView(input(null, { isBeta: true }));
    assert.equal(v.headline, "Free during beta. Nothing is charged.");
    assert.equal(v.shortLabel, "Free during beta");
    assert.equal(v.ratesTitle, "Rates after beta");
    assert.doesNotMatch(`${v.headline} ${v.onDemandHint}`, /invoice/);
  });
});

describe("ownerBillingView rows", () => {
  it("labels SMS credits with the message count", () => {
    const v = ownerBillingView(input(esgaRow));
    const sms = v.rows.find((r) => r.key === "sms");
    assert.ok(sms);
    assert.equal(sms.used, 193);
    assert.equal(sms.left, 7);
    assert.equal(sms.note, "193 credits used (102 messages)");
  });

  it("seats come from seat_included and tenant_seats_used", () => {
    const seats = ownerBillingView(input(esgaRow)).rows.find((r) => r.key === "seats");
    assert.ok(seats);
    assert.equal(seats.included, 3);
    assert.equal(seats.used, 1);
  });

  it("the texts-only bucket never raises the notice on its own", () => {
    const v = ownerBillingView(input(esgaRow));
    assert.equal(v.lowNotice, null);
  });

  it("no notice when nothing is low", () => {
    const v = ownerBillingView(input({ ...esgaRow, sms_used: 20 }));
    assert.equal(v.lowNotice, null);
  });
});

describe("lowBalanceNotice", () => {
  const view = (over: Partial<TenantBillingStateRow> = {}) =>
    ownerBillingView(input({ ...esgaRow, used_seconds: 0, ...over }));
  const credits = (left: number) => ({ included: 1000, used: 1000 - left, left });

  it("warns on the shared credit total in plain words, and beta says nothing is charged", () => {
    const low = lowBalanceNotice(view(), credits(40));
    assert.equal(low.lowNotice, "Message credits are running low. 40 of 1,000 left until 31 Oct.");
    assert.match(String(low.lowNoticeNote), /During beta nothing is charged/);
  });

  it("low rule: 10% or less of the allowance left (150 left is not low, 100 is)", () => {
    assert.equal(lowBalanceNotice(view(), credits(150)).lowNotice, null);
    assert.ok(lowBalanceNotice(view(), credits(100)).lowNotice);
  });

  it("hides the credits warning without message_credits, same as Usage", () => {
    assert.equal(lowBalanceNotice(view({ sms_used: 199 }), null).lowNotice, null);
  });

  it("joins low minutes and low credits in one line", () => {
    const low = lowBalanceNotice(view({ used_seconds: 290 * 60 }), credits(20));
    assert.equal(
      low.lowNotice,
      "Minutes and message credits are running low. 10 minutes and 20 credits left until 31 Oct.",
    );
  });

  it("paid modes: extra usage on bills next invoice; off names only what stops calls", () => {
    const metered = lowBalanceNotice(view({ mode_label: "metered" }), credits(40));
    assert.match(String(metered.lowNotice), /next invoice/);
    const capped = lowBalanceNotice(view({ mode_label: "capped", on_demand_enabled: false }), credits(40));
    assert.equal(capped.lowNotice, "Message credits are running low. 40 of 1,000 left until 31 Oct.");
    const cappedMinutes = lowBalanceNotice(view({ mode_label: "capped", on_demand_enabled: false, used_seconds: 290 * 60 }), null);
    assert.match(String(cappedMinutes.lowNotice), /When minutes run out, calls stop unless you turn on extra usage\.$/);
    for (const low of [metered, capped, cappedMinutes]) {
      assert.doesNotMatch(String(low.lowNotice), /\bSMS\b|to callers stop/);
    }
  });

  it("Home builds the notice from the shared total", () => {
    const home = fs.readFileSync(path.join(root, "dashboard/src/app/(desk)/home/page.tsx"), "utf8");
    const model = fs.readFileSync(path.join(root, "dashboard/src/lib/billingStateModel.ts"), "utf8");
    assert.match(
      home,
      /lowBalanceNotice\(billing, messageCreditsUsage\(extras\.messageCredits, extras\.creditBurns, billing\.messageUse\)\)/,
    );
    assert.doesNotMatch(home, /billing\?\.lowNotice/);
    assert.doesNotMatch(model, /SMS to callers/);
  });
});

describe("periodEndLabel", () => {
  it("shows the last day of the period in Nairobi time", () => {
    assert.equal(periodEndLabel("2026-10-31T21:00:00Z"), "31 Oct");
    assert.equal(periodEndLabel(null), null);
  });
});
