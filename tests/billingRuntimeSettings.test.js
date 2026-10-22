"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { overlayRuntimeEnv, runtimeSettingsFromRow } = require("../src/billing/billingRuntimeSettings");

describe("billing runtime settings", () => {
  it("overlays DB switches onto env", () => {
    const settings = runtimeSettingsFromRow({
      bachs_payments_mode: "sandbox",
      live_payments_master: false,
      billing_notices_send: true,
      desk_plan_change_enabled: true,
    });
    assert.equal(settings?.available, true);
    const env = overlayRuntimeEnv(
      { BACHS_MODE: "live", BACHS_LIVE_ALLOWED: "true", BILLING_NOTICES_SEND: "off", DESK_PLAN_CHANGE: "off" },
      settings,
    );
    assert.equal(env.BACHS_MODE, "sandbox");
    assert.equal(env.BACHS_LIVE_ALLOWED, "false");
    assert.equal(env.BILLING_NOTICES_SEND, "on");
    assert.equal(env.DESK_PLAN_CHANGE, "on");
  });

  it("leaves env when settings are unavailable", () => {
    const base = { BACHS_MODE: "off" };
    assert.deepEqual(overlayRuntimeEnv(base, null), base);
  });
});
