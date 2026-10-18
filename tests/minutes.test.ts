/**
 * One minutes rule for every owner screen: a started minute of metered seconds counts.
 * Run: node --experimental-strip-types --no-warnings --import ./tests/serverOnlyHook.mjs --test tests/minutes.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minutesLeft, minutesUsedFromSeconds } from "../dashboard/src/lib/minutes.ts";
import { ownerBillingView } from "../dashboard/src/lib/billingStateModel.ts";
import { trialRemaining } from "../dashboard/src/lib/trialRemaining.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function usage(state: Record<string, unknown>) {
  return ownerBillingView({
    state: { package_state: "active", package_name: "Growth", included_minutes: 800, mode_label: "capped", ...state },
    monthlyPriceKes: 12000,
    smsMessages: null,
    seatsIncluded: 5,
    seatsUsed: 1,
  });
}

describe("minutes from seconds", () => {
  it("counts a started minute", () => {
    assert.equal(minutesUsedFromSeconds(0), 0);
    assert.equal(minutesUsedFromSeconds(1), 1);
    assert.equal(minutesUsedFromSeconds(60), 1);
    assert.equal(minutesUsedFromSeconds(61), 2);
    assert.equal(minutesUsedFromSeconds("125"), 3);
    assert.equal(minutesUsedFromSeconds(-30), 0);
    assert.equal(minutesUsedFromSeconds(null), 0);
    assert.equal(minutesLeft(800, 61), 798);
    assert.equal(minutesLeft(1, 600), 0);
  });

  it("Usage reads metered seconds, not the view's one-decimal used_minutes", () => {
    // 61 s: the view rounds used_minutes to 1.0 and remaining to 799.0. Plan says 2 used.
    const view = usage({ used_seconds: 61, used_minutes: 1.0, remaining_minutes: 799.0 });
    assert.equal(view.minutesUsed, 2);
    assert.equal(view.minutesLeft, 798);
    assert.equal(view.rows.find((row) => row.key === "minutes")?.used, 2);
  });

  it("Usage, Plan, Home, and trial agree for the same seconds", () => {
    for (const seconds of [0, 59, 60, 61, 119, 47_999, 48_000, 48_061]) {
      const used = minutesUsedFromSeconds(seconds);
      const view = usage({ used_seconds: seconds });
      assert.equal(view.minutesUsed, used, `usage ${seconds}`);
      assert.equal(view.minutesLeft, minutesLeft(800, seconds), `usage left ${seconds}`);
      const trial = trialRemaining({ now: new Date("2026-10-01T00:00:00Z"), trialEndsAt: "2026-10-10T00:00:00Z", secondsUsed: seconds, minutesIncluded: 800 });
      assert.equal(trial.minutesLeft, minutesLeft(800, seconds), `trial ${seconds}`);
    }
  });

  it("every minutes loader goes through the shared helper", () => {
    const plan = read("dashboard/src/lib/ownerPlanLoad.ts");
    assert.match(plan, /minutesUsed: minutesUsedFromSeconds\(row\.seconds_used\)/);
    assert.match(read("dashboard/src/lib/packageCatalog.ts"), /from "@\/lib\/minutes"/);
    assert.match(read("dashboard/src/lib/trialRemaining.ts"), /from "\.\/minutes"/);
    assert.match(read("dashboard/src/lib/billingStateLoad.ts"), /used_seconds/);
    assert.match(read("dashboard/src/app/(desk)/wallet/page.tsx"), /minutesUsed=\{view\.minutesUsed\}/);
    for (const file of ["ownerPlanLoad.ts", "packageCatalog.ts", "trialRemaining.ts", "billingStateModel.ts"]) {
      assert.doesNotMatch(read(`dashboard/src/lib/${file}`), /seconds_?[uU]sed\)? ?\/ ?60/, file);
    }
  });
});
