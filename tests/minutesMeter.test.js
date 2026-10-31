const { test } = require("node:test");
const assert = require("node:assert/strict");

test("minutes meter states follow the package, not a sample", async () => {
  const { minutesMeterState, minutesMeterFill, minutesRingFill } = await import("../dashboard/src/lib/minutesMeter.ts");
  assert.equal(minutesMeterState({ included: 0, used: 0, left: 0, underOne: false, mode: "none", overLabel: null }), "none");
  assert.equal(minutesMeterState({ included: 300, used: 40, left: 260, underOne: false, mode: "beta", overLabel: null }), "beta");
  assert.equal(minutesMeterState({ included: 300, used: 280, left: 20, underOne: false, mode: "capped", overLabel: null }), "low");
  assert.equal(minutesMeterState({ included: 300, used: 300, left: 0, underOne: false, mode: "capped", overLabel: null }), "limit");
  assert.equal(minutesMeterState({ included: 300, used: 300, left: 0, underOne: false, mode: "beta", overLabel: null }), "beta");
  assert.notEqual(minutesMeterState({ included: 300, used: 300, left: 0, underOne: false, mode: "beta", overLabel: null }), "low");
  assert.equal(minutesMeterState({ included: 300, used: 340, left: 0, underOne: false, mode: "metered", overLabel: "40 min over" }), "over");
  assert.equal(minutesMeterState({ included: 300, used: 299, left: 1, underOne: true, mode: "capped", overLabel: null }), "under1");
  assert.equal(minutesMeterFill({ included: 100, used: 50, left: 50, underOne: false, mode: "capped", overLabel: null }), 0.5);
  assert.equal(minutesMeterFill({ included: 100, used: 140, left: 0, underOne: false, mode: "metered", overLabel: null }), 1);
  const usedUp = { included: 300, used: 300, left: 0, underOne: false, mode: "metered", overLabel: null };
  assert.equal(minutesMeterState(usedUp), "usedup");
  assert.equal(minutesRingFill(usedUp), 0);
  assert.equal(minutesRingFill({ included: 300, used: 300, left: 0, underOne: false, mode: "beta", overLabel: null }), 1);
});
