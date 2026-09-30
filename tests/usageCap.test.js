const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { usageCapNotice, homeMinuteStatus } = require("../dashboard/src/lib/usageCap.ts");

const empty = {
  isBeta: false,
  onDemand: false,
  minutesIncluded: 300,
  minutesLeft: 10,
  smsIncluded: 200,
  smsLeft: 4,
  emailIncluded: 100,
  emailLeft: 3,
  waIncluded: 200,
  waLeft: 8,
};

describe("usage cap copy", () => {
  it("stays quiet while buckets remain, on beta, and when on-demand is on", () => {
    assert.equal(usageCapNotice(empty), null);
    assert.equal(
      usageCapNotice({ ...empty, isBeta: true, minutesLeft: 0 }),
      "Included minutes used. Calls stopped."
    );
    assert.equal(usageCapNotice({ ...empty, isBeta: true, smsLeft: 0 }), null);
    assert.equal(usageCapNotice({ ...empty, onDemand: true, minutesLeft: 0 }), null);
    assert.equal(
      homeMinuteStatus({ isBeta: true, onDemand: false, minutesIncluded: 300, minutesLeft: 12 }),
      null
    );
  });

  it("says calls still answer and tenant SMS stops when those caps are hit", () => {
    assert.equal(
      usageCapNotice({ ...empty, minutesLeft: 0 }),
      "Included minutes used. Calls stopped."
    );
    assert.equal(
      usageCapNotice({ ...empty, smsLeft: 0 }),
      "Included SMS used. Tenant SMS stopped."
    );
    assert.equal(
      usageCapNotice({ ...empty, minutesLeft: 0, smsLeft: 0 }),
      "Included used. Calls stopped. Tenant SMS stopped."
    );
    assert.equal(
      homeMinuteStatus({ isBeta: false, onDemand: false, minutesIncluded: 300, minutesLeft: 0 }),
      "Stopped"
    );
    assert.equal(
      homeMinuteStatus({ isBeta: true, onDemand: false, minutesIncluded: 300, minutesLeft: 0 }),
      "Stopped"
    );
    assert.equal(
      homeMinuteStatus({ isBeta: false, onDemand: true, minutesIncluded: 300, minutesLeft: 0 }),
      "On-demand"
    );
  });
});
