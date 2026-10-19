/**
 * Trial copy: days or minutes, whichever runs out first.
 * Run: node --experimental-strip-types --test tests/trialRemaining.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trialRemaining } from "../dashboard/src/lib/trialRemaining.ts";

const now = new Date("2026-10-01T00:00:00+03:00");

describe("trialRemaining", () => {
  it("names days and minutes while both remain", () => {
    const left = trialRemaining({
      now,
      trialEndsAt: "2026-10-06T00:00:00+03:00",
      secondsUsed: 60,
      minutesIncluded: 21,
    });
    assert.equal(left.ended, false);
    assert.equal(left.daysLeft, 5);
    assert.equal(left.minutesLeft, 20);
    assert.equal(left.text, "Trial: 5 days or 20 minutes left");
  });

  it("ends when the days hit zero, even if minutes remain", () => {
    const left = trialRemaining({
      now,
      trialEndsAt: "2026-10-01T00:00:00+03:00",
      secondsUsed: 0,
      minutesIncluded: 20,
    });
    assert.equal(left.ended, true);
    assert.equal(left.text, "Trial ended");
  });

  it("ends when the minutes hit zero, even if days remain", () => {
    const left = trialRemaining({
      now,
      trialEndsAt: "2026-10-10T00:00:00+03:00",
      secondsUsed: 20 * 60,
      minutesIncluded: 20,
    });
    assert.equal(left.ended, true);
    assert.equal(left.minutesLeft, 0);
    assert.equal(left.text, "Trial ended");
  });
});
