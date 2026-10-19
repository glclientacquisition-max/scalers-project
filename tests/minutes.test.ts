/**
 * One minutes rule for every owner screen. Billing debits seconds, so a minute
 * shows as used only once all 60 seconds are used.
 * Run: node --experimental-strip-types --no-warnings --import ./tests/serverOnlyHook.mjs --test tests/minutes.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minuteMeter, minutesLeft, minutesLeftLabel, minutesUsedFromSeconds } from "../dashboard/src/lib/minutes.ts";
import { ownerBillingView } from "../dashboard/src/lib/billingStateModel.ts";
import { trialRemaining } from "../dashboard/src/lib/trialRemaining.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const INCLUDED = 800;
const CAP = INCLUDED * 60;

function usage(state: Record<string, unknown>) {
  return ownerBillingView({
    state: { package_state: "active", package_name: "Growth", included_minutes: INCLUDED, mode_label: "capped", ...state },
    monthlyPriceKes: 12000,
    smsMessages: null,
    seatsIncluded: 5,
    seatsUsed: 1,
  });
}

describe("minutes from seconds", () => {
  it("rounds used minutes down, and left is included minus that", () => {
    assert.equal(minutesUsedFromSeconds(0), 0);
    assert.equal(minutesUsedFromSeconds(59), 0);
    assert.equal(minutesUsedFromSeconds(60), 1);
    assert.equal(minutesUsedFromSeconds(61), 1);
    assert.equal(minutesUsedFromSeconds("125"), 2);
    assert.equal(minutesUsedFromSeconds(-30), 0);
    assert.equal(minutesUsedFromSeconds(null), 0);
    assert.equal(minutesLeft(INCLUDED, 61), 799);
    assert.equal(minutesLeft(1, 600), 0);
  });

  it("covers 0, 59, 60, 61, cap minus 30 s, cap, and cap plus 750 s", () => {
    const cases = [
      { seconds: 0, used: 0, left: 800, under: false, over: null },
      { seconds: 59, used: 0, left: 800, under: false, over: null },
      { seconds: 60, used: 1, left: 799, under: false, over: null },
      { seconds: 61, used: 1, left: 799, under: false, over: null },
      { seconds: CAP - 30, used: 799, left: 1, under: true, over: null },
      { seconds: CAP, used: 800, left: 0, under: false, over: null },
      { seconds: CAP + 750, used: 812, left: 0, under: false, over: "12 min 30 s over" },
    ];
    for (const row of cases) {
      const meter = minuteMeter(INCLUDED, row.seconds);
      assert.equal(meter.used, row.used, `used ${row.seconds}`);
      assert.equal(meter.left, row.left, `left ${row.seconds}`);
      assert.equal(meter.underOneMinute, row.under, `under ${row.seconds}`);
      assert.equal(meter.overLabel, row.over, `over ${row.seconds}`);
      if (row.over == null) assert.equal(meter.used + meter.left, INCLUDED, `adds up ${row.seconds}`);
      assert.equal(minutesLeftLabel(meter), row.under ? "Under 1 min left" : `${row.left.toLocaleString("en-KE")} min left`);

      const view = usage({ used_seconds: row.seconds, used_minutes: 1.0, remaining_minutes: 799.0 });
      assert.equal(view.minutesUsed, row.used, `usage used ${row.seconds}`);
      assert.equal(view.minutesLeft, row.left, `usage left ${row.seconds}`);
      assert.equal(view.minutesUnderOne, row.under, `usage under ${row.seconds}`);
      assert.equal(view.minutesOverLabel, row.over, `usage over ${row.seconds}`);
      assert.equal(view.rows.find((item) => item.key === "minutes")?.used, row.used);

      const trial = trialRemaining({
        now: new Date("2026-10-01T00:00:00Z"),
        trialEndsAt: "2026-10-10T00:00:00Z",
        secondsUsed: row.seconds,
        minutesIncluded: INCLUDED,
      });
      assert.equal(trial.minutesLeft, row.left, `trial ${row.seconds}`);
      if (row.under) assert.match(trial.text, /under 1 min left/);
      if (row.left === 0) assert.equal(trial.text, "Trial ended");
    }
  });

  it("ignores the view's pre-rounded minute columns", () => {
    const load = read("dashboard/src/lib/billingStateLoad.ts");
    assert.match(load, /used_seconds/);
    assert.doesNotMatch(load, /used_minutes|remaining_minutes/);
    for (const file of [
      "dashboard/src/lib/billingStateModel.ts",
      "dashboard/src/lib/ownerUsageLoad.ts",
      "dashboard/src/lib/ownerPlanLoad.ts",
      "dashboard/src/app/(desk)/home/page.tsx",
      "dashboard/src/app/(desk)/wallet/page.tsx",
    ]) {
      assert.doesNotMatch(read(file), /used_minutes|remaining_minutes/, file);
    }
  });

  it("every minutes loader goes through the shared helper", () => {
    const plan = read("dashboard/src/lib/ownerPlanLoad.ts");
    assert.match(plan, /minutesUsed: minutesUsedFromSeconds\(row\.seconds_used\)/);
    assert.match(read("dashboard/src/lib/packageCatalog.ts"), /from "@\/lib\/minutes"/);
    assert.match(read("dashboard/src/lib/trialRemaining.ts"), /from "\.\/minutes"/);
    assert.match(read("dashboard/src/lib/billingStateModel.ts"), /minuteMeter\(state\?\.included_minutes, state\?\.used_seconds\)/);
    assert.match(read("dashboard/src/app/(desk)/wallet/page.tsx"), /minutesUsed=\{view\.minutesUsed\}/);
    assert.match(read("dashboard/src/app/(desk)/wallet/page.tsx"), /minutesOverLabel=\{view\.minutesOverLabel\}/);
    assert.match(read("dashboard/src/components/plan/UsageSummary.tsx"), /Under 1 min left/);
    assert.match(read("dashboard/src/components/plan/UsageSummary.tsx"), /minutesOverLabel/);
    for (const file of ["ownerPlanLoad.ts", "packageCatalog.ts", "trialRemaining.ts", "billingStateModel.ts"]) {
      assert.doesNotMatch(read(`dashboard/src/lib/${file}`), /seconds_?[uU]sed\)? ?\/ ?60/, file);
    }
  });
});
