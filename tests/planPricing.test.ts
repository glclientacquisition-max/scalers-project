/**
 * Annual price, the split-pay note, proration, and the closed plan-change port.
 * Run: node --experimental-strip-types --test tests/planPricing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowanceChanges,
  allowanceLines,
  annualPriceFromVersion,
  annualPriceKes,
  annualSavingKes,
  downgradeStartsOn,
  nairobiMonthName,
  nairobiPeriodDays,
  proratedPortionKes,
  proratedUpgradeKes,
  seatIncreaseCopy,
  seatReductionCopy,
  seatUnitKes,
  planDowngradeChanges,
  planUpgradeCopy,
  seatBlockCopy,
  spendLimitDisplayKes,
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
    assert.equal(annualPriceFromVersion(18000, 10, 200000), 200000);
    assert.equal(annualPriceFromVersion(18000, 10, null), 194400);
    assert.equal(annualPriceFromVersion(18000, 10, undefined), 194400);
  });

  it("uses the version spend share, and 50 when the column is missing", () => {
    assert.equal(spendLimitDisplayKes(null, 18000, 40), 7200);
    assert.equal(spendLimitDisplayKes(null, 18000, null), 9000);
    assert.equal(spendLimitDisplayKes(null, 18000), 9000);
    assert.equal(spendLimitDisplayKes(1000, 18000, 40), 1000);
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
    const end = "2026-10-31T00:00:00+03:00";
    const clock = nairobiPeriodDays("2026-10-01T00:00:00+03:00", end, new Date("2026-10-11T09:00:00+03:00"));
    assert.deepEqual(clock, { daysInPeriod: 30, daysLeft: 20 });
    const unit = seatUnitKes(500, "month", 10);
    assert.equal(unit, 500);
    assert.equal(proratedPortionKes(unit, clock!.daysLeft, clock!.daysInPeriod), 333);
    assert.equal(nairobiMonthName(end), "October");
    assert.equal(
      seatIncreaseCopy({
        quantity: 1,
        monthlyKes: 500,
        unitKes: unit,
        daysLeft: clock!.daysLeft,
        daysInPeriod: clock!.daysInPeriod,
        periodMonth: nairobiMonthName(end),
      }),
      "KSh 333 today for the rest of October, then KSh 500 a month.",
    );
    assert.equal(
      seatIncreaseCopy({
        quantity: 2,
        monthlyKes: 500,
        unitKes: unit,
        daysLeft: clock!.daysLeft,
        daysInPeriod: clock!.daysInPeriod,
        periodMonth: "October",
      }),
      "KSh 667 today for the rest of October, then KSh 1,000 a month.",
    );
    assert.equal(
      seatReductionCopy({ seats: 0, monthlyKes: 500, nextPeriodStart: "31 Oct" }),
      "From 31 Oct you pay KSh 0 a month for extra seats.",
    );
    assert.equal(
      seatReductionCopy({ seats: 2, monthlyKes: 500, nextPeriodStart: "31 Oct" }),
      "From 31 Oct you pay KSh 1,000 a month for extra seats.",
    );
    assert.equal(seatUnitKes(500, "year", 10), annualPriceKes(500, 10));
  });

  it("starts a downgrade at the period end", () => {
    const end = new Date("2026-10-31T21:00:00Z");
    assert.equal(downgradeStartsOn(end).toISOString(), end.toISOString());
  });
});

describe("plan change port", () => {
  it("stays closed when the flag is off", async () => {
    const prev = process.env.DESK_PLAN_CHANGE;
    try {
      delete process.env.DESK_PLAN_CHANGE;
      const off = await planChangePort().changePlan({
        sku: "growth",
        cycle: "year",
        idempotencyKey: "k1",
      });
      assert.deepEqual(off, { ok: false, message: "Plan changes are not open on this desk yet." });
    } finally {
      if (prev === undefined) delete process.env.DESK_PLAN_CHANGE;
      else process.env.DESK_PLAN_CHANGE = prev;
    }
  });

  it("delegates to owner billing RPCs when the flag is on", () => {
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../dashboard/src/lib/deskPlanChange.ts"),
      "utf8",
    );
    assert.match(src, /planChangeRpc\.server/);
    assert.match(src, /rpcChangePlan/);
  });
});

describe("plan change copy", () => {
  const starter = { minutes: 300, seats: 3, messageCredits: 1000 };
  const growth = { minutes: 800, seats: 8, messageCredits: 2500 };
  const scale = { minutes: 1600, seats: 20, messageCredits: 5500 };

  it("upgrade: today until the period end, then the new price", () => {
    const due = proratedUpgradeKes(18000, 35000, 10, 30);
    assert.equal(
      planUpgradeCopy({ dueKes: due, laterKes: 35000, cycle: "month", periodMonth: "October", nextPeriodStart: "1 Nov" }),
      "KSh 11,333 today until 1 Nov, then KSh 35,000 a month.",
    );
  });

  it("upgrade names the period end when the period crosses months", () => {
    assert.equal(
      planUpgradeCopy({
        dueKes: 16452,
        laterKes: 35000,
        cycle: "month",
        periodMonth: "November",
        nextPeriodStart: "18 Nov",
      }),
      "KSh 16,452 today until 18 Nov, then KSh 35,000 a month.",
    );
    assert.equal(
      planUpgradeCopy({
        dueKes: 16452,
        laterKes: 378000,
        cycle: "year",
        periodMonth: null,
        nextPeriodStart: "18 Nov",
      }),
      "KSh 16,452 today until 18 Nov, then KSh 378,000 a year.",
    );
    assert.doesNotMatch(
      planUpgradeCopy({
        dueKes: 16452,
        laterKes: 35000,
        cycle: "month",
        periodMonth: "November",
        nextPeriodStart: "18 Nov",
      }),
      /rest of November/,
    );
  });

  it("downgrade lists what changes at renewal", () => {
    assert.equal(
      planDowngradeChanges(growth, starter, "1 Nov"),
      "From 1 Nov: 300 minutes (now 800), 3 seats (now 8), 1,000 message credits (now 2,500).",
    );
  });

  it("before and after rows in card order", () => {
    assert.deepEqual(allowanceChanges(growth, scale), [
      { label: "Minutes", from: "800", to: "1,600" },
      { label: "Seats", from: "8", to: "20" },
      { label: "Message credits", from: "2,500", to: "5,500" },
    ]);
    assert.deepEqual(allowanceLines(growth), ["800 minutes", "8 seats", "2,500 message credits"]);
  });

  it("blocks a downgrade when too many seats are in use", () => {
    assert.equal(seatBlockCopy(5, 3), "Remove 2 team members first.");
    assert.equal(seatBlockCopy(4, 3), "Remove 1 team member first.");
    assert.equal(seatBlockCopy(3, 3), null);
  });
});
