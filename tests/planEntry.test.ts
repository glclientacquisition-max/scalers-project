/**
 * Plan entry points and usage meter tones.
 * Run: node --experimental-strip-types --no-warnings --test tests/planEntry.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MINUTES_WARN_SHARE,
  meterTone,
  planEntry,
  planRowText,
  usedPercent,
} from "../dashboard/src/lib/planEntry.ts";

describe("planEntry", () => {
  it("beta has no plan change anywhere", () => {
    assert.equal(planEntry("beta", true), null);
    assert.equal(planEntry(null, true), null);
  });

  it("trial picks a first plan with the filled button", () => {
    assert.deepEqual(planEntry("trialing", true), {
      href: "/settings/plan",
      label: "Choose a plan",
      variant: "primary",
    });
  });

  it("paid gets a tonal Change plan, only with billing.manage", () => {
    assert.equal(planEntry("active", true)?.label, "Change plan");
    assert.equal(planEntry("active", true)?.variant, "tonal");
    assert.equal(planEntry("active", false), null);
  });
});

describe("planRowText", () => {
  it("shows the plan name, or Choose a plan on trial", () => {
    assert.equal(planRowText("active", "Growth"), "Growth");
    assert.equal(planRowText("beta", "Starter"), "Starter");
    assert.equal(planRowText("trialing", "Growth"), "Choose a plan");
    assert.equal(planRowText("active", null), "");
  });
});

describe("meterTone", () => {
  it("minutes warn from 80% used and are full at 100%", () => {
    assert.equal(meterTone(239, 300, MINUTES_WARN_SHARE), "ok");
    assert.equal(meterTone(240, 300, MINUTES_WARN_SHARE), "warn");
    assert.equal(meterTone(297, 300, MINUTES_WARN_SHARE), "warn");
    assert.equal(meterTone(300, 300, MINUTES_WARN_SHARE), "full");
  });

  it("seats and credits warn only when used up", () => {
    assert.equal(meterTone(2, 3, null), "ok");
    assert.equal(meterTone(3, 3, null), "full");
    assert.equal(meterTone(0, 0, null), "ok");
  });

  it("bar fill is the share used", () => {
    assert.equal(usedPercent(297, 300), 99);
    assert.equal(usedPercent(400, 300), 100);
    assert.equal(usedPercent(5, 0), 0);
  });
});
