/**
 * Owner billing state mapping (tenant_billing_state → Usage copy).
 * Run: node --experimental-strip-types --no-warnings --test tests/billingStateModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billingModeOf,
  ownerBillingView,
  periodEndLabel,
  type OwnerBillingInput,
  type TenantBillingStateRow,
} from "../dashboard/src/lib/billingStateModel.ts";

const esgaRow: TenantBillingStateRow = {
  package_state: "active",
  package_name: "Starter",
  billing_term: "month",
  period_start: "2026-09-30T21:00:00Z",
  period_end: "2026-10-31T21:00:00Z",
  included_minutes: 300,
  used_minutes: 104.2,
  remaining_minutes: 195.8,
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
    assert.match(v.headline, /^Starter · KES 4,000 a month\. Usage past what's included is added to your next invoice/);
    assert.doesNotMatch(v.headline, /5,000/);
  });

  it("capped names the period end", () => {
    const v = ownerBillingView(input({ ...esgaRow, mode_label: "capped", on_demand_enabled: false }));
    assert.match(v.headline, /calls stop until 31 Oct unless you turn on extra usage/);
  });

  it("no package", () => {
    const v = ownerBillingView(input(null));
    assert.equal(v.headline, "No package. All usage is billed at the rates below.");
  });
});

describe("ownerBillingView rows", () => {
  it("labels SMS credits with the message count", () => {
    const v = ownerBillingView(input(esgaRow));
    const sms = v.rows.find((r) => r.key === "sms");
    assert.ok(sms);
    assert.equal(sms.used, 193);
    assert.equal(sms.left, 7);
    assert.match(String(sms.note), /193 SMS credits \(102 messages\)/);
  });

  it("seats come from seat_included and tenant_seats_used", () => {
    const seats = ownerBillingView(input(esgaRow)).rows.find((r) => r.key === "seats");
    assert.ok(seats);
    assert.equal(seats.included, 3);
    assert.equal(seats.used, 1);
  });

  it("low SMS shows a notice even with extra usage on, and beta says nothing is charged", () => {
    const v = ownerBillingView(input(esgaRow));
    assert.ok(v.lowNotice);
    assert.match(String(v.lowNotice), /During beta nothing is charged/);
    const metered = ownerBillingView(input({ ...esgaRow, mode_label: "metered" }));
    assert.match(String(metered.lowNotice), /next invoice/);
  });

  it("no notice when nothing is low", () => {
    const v = ownerBillingView(input({ ...esgaRow, sms_used: 20 }));
    assert.equal(v.lowNotice, null);
  });
});

describe("periodEndLabel", () => {
  it("shows the last day of the period in Nairobi time", () => {
    assert.equal(periodEndLabel("2026-10-31T21:00:00Z"), "31 Oct");
    assert.equal(periodEndLabel(null), null);
  });
});
