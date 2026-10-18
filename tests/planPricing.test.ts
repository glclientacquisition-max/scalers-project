/**
 * Annual price, the split-pay note, proration, and the closed plan-change port.
 * Run: node --experimental-strip-types --test tests/planPricing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  annualPriceKes,
  annualSavingKes,
  downgradeStartsOn,
  nairobiPeriodDays,
  proratedPortionKes,
  proratedUpgradeKes,
  seatUnitKes,
  splitPayNote,
} from "../dashboard/src/lib/planPricing.ts";
import { planChangePort } from "../dashboard/src/lib/deskPlanChange.ts";

describe("plan pricing", () => {
  it("prices the spec annual totals and savings", () => {
    assert.equal(annualPriceKes(7000, 17), 69720);
    assert.equal(annualSavingKes(7000, 17), 14280);
    assert.equal(annualPriceKes(18000, 10), 194400);
    assert.equal(annualSavingKes(18000, 10), 21600);
    assert.equal(annualPriceKes(35000, 10), 378000);
    assert.equal(annualSavingKes(35000, 10), 42000);
  });

  it("adds the split note only above KSh 150,000", () => {
    assert.equal(splitPayNote(69720), null);
    assert.equal(splitPayNote(194400), "Over KSh 150,000, so you can pay in parts.");
    assert.equal(splitPayNote(378000), "Over KSh 150,000, so you can pay in parts.");
  });

  it("prorates Starter to Growth on day 10 of 30 as 7333", () => {
    assert.equal(proratedUpgradeKes(7000, 18000, 10, 30), 7333);
  });

  it("prorates an extra seat from the version price and the days left", () => {
    const clock = nairobiPeriodDays("2026-10-01T00:00:00+03:00", "2026-10-31T00:00:00+03:00", new Date("2026-10-11T09:00:00+03:00"));
    assert.deepEqual(clock, { daysInPeriod: 30, daysLeft: 20 });
    const unit = seatUnitKes(500, "month", 10);
    assert.equal(unit, 500);
    assert.equal(proratedPortionKes(unit, clock!.daysLeft, clock!.daysInPeriod), 333);
    assert.equal(seatUnitKes(500, "year", 10), annualPriceKes(500, 10));
  });

  it("starts a downgrade at the period end", () => {
    const end = new Date("2026-10-31T21:00:00Z");
    assert.equal(downgradeStartsOn(end).toISOString(), end.toISOString());
  });
});

describe("plan change port", () => {
  it("stays closed with the flag off and with the flag on", async () => {
    const prev = process.env.DESK_PLAN_CHANGE;
    try {
      delete process.env.DESK_PLAN_CHANGE;
      const off = await planChangePort().changePlan({ sku: "growth", cycle: "year" });
      assert.deepEqual(off, { ok: false, message: "Plan changes open soon" });
      process.env.DESK_PLAN_CHANGE = "true";
      const on = await planChangePort().setExtraSeats({ extraSeats: 2, idempotencyKey: "seat-key" });
      assert.equal(on.ok, false);
      assert.equal(on.message, "Plan changes open soon");
    } finally {
      if (prev === undefined) delete process.env.DESK_PLAN_CHANGE;
      else process.env.DESK_PLAN_CHANGE = prev;
    }
  });
});
