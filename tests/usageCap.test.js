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
  it("stays quiet while buckets remain, and beta does not stop calls", () => {
    assert.equal(usageCapNotice(empty), null);
    assert.equal(
      usageCapNotice({ ...empty, isBeta: true, minutesLeft: 0 }),
      "Included minutes used. During beta, calls keep working and nothing is charged."
    );
    assert.equal(usageCapNotice({ ...empty, isBeta: true, smsLeft: 0 }), null);
    assert.equal(
      usageCapNotice({ ...empty, onDemand: true, minutesLeft: 0 }),
      "Included minutes used. Extra minutes are billed on your next invoice."
    );
    assert.doesNotMatch(
      usageCapNotice({ ...empty, onDemand: true, minutesLeft: 0 }) || "",
      /rates on Usage/
    );
    assert.equal(
      homeMinuteStatus({ isBeta: true, onDemand: false, minutesIncluded: 300, minutesLeft: 12 }),
      null
    );
  });

  it("says calls stop when the cap is hit, and extra usage is billed on the next invoice", () => {
    assert.equal(
      usageCapNotice({ ...empty, minutesLeft: 0 }),
      "Included minutes used. Calls have stopped."
    );
    assert.equal(
      usageCapNotice({ ...empty, smsLeft: 0 }),
      "Included SMS used. SMS to callers have stopped."
    );
    assert.equal(
      usageCapNotice({ ...empty, minutesLeft: 0, smsLeft: 0 }),
      "Included minutes and SMS used. Calls and SMS to callers have stopped."
    );
    assert.equal(
      usageCapNotice({ ...empty, onDemand: true, minutesLeft: 0 }),
      "Included minutes used. Extra minutes are billed on your next invoice."
    );
    assert.equal(
      homeMinuteStatus({ isBeta: false, onDemand: false, minutesIncluded: 300, minutesLeft: 0 }),
      "Calls stopped"
    );
    assert.equal(
      homeMinuteStatus({ isBeta: true, onDemand: false, minutesIncluded: 300, minutesLeft: 0 }),
      null
    );
    assert.equal(
      homeMinuteStatus({ isBeta: false, onDemand: true, minutesIncluded: 300, minutesLeft: 0 }),
      "Extra usage"
    );
  });
});
