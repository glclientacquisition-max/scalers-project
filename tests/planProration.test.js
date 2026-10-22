const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { prorateKes, versionPriceKes, prorationQuote } = require("../src/billing/planProration");

const START = "2026-10-01T00:00:00+03:00";
const END = "2026-10-31T00:00:00+03:00";
const NOW = "2026-10-21T12:00:00+03:00";

describe("plan proration", () => {
  it("credits 10 of 30 days from 7000 and charges 18000", () => {
    const quote = prorationQuote({
      currentPriceKes: 7000,
      newPriceKes: 18000,
      start: START,
      end: END,
      now: NOW,
    });
    assert.deepEqual(quote, {
      creditKes: 2333,
      chargeKes: 6000,
      totalKes: 3667,
      daysLeft: 10,
      daysInPeriod: 30,
    });
  });

  it("rounds half away from zero to a whole shilling", () => {
    assert.equal(prorateKes(1000, 1, 3), 333);
    assert.equal(prorateKes(1, 1, 2), 1);
    assert.equal(prorateKes(0, 10, 30), 0);
    assert.equal(prorateKes(7000, 0, 30), 0);
  });

  it("annual prices follow the version discount", () => {
    assert.equal(versionPriceKes(7000, "year", 17), 69720);
    assert.equal(versionPriceKes(18000, "year", 10), 194400);
    assert.equal(versionPriceKes(35000, "year", 10), 378000);
    assert.equal(versionPriceKes(7000, "month", 17), 7000);
  });
});
