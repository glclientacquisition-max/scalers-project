/**
 * Admin step-up observe gate (s21). Pure mode parsing + observe log; enforce not used.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () => import(path.join(root, "dashboard/src/lib/ops/stepUp.ts"));

describe("ADMIN_STEP_UP mode", () => {
  it("defaults to observe", async () => {
    const { stepUpMode } = await load();
    assert.equal(stepUpMode({}), "observe");
    assert.equal(stepUpMode({ ADMIN_STEP_UP: "" }), "observe");
    assert.equal(stepUpMode({ ADMIN_STEP_UP: "weird" }), "observe");
  });

  it("accepts off, observe, enforce", async () => {
    const { stepUpMode } = await load();
    assert.equal(stepUpMode({ ADMIN_STEP_UP: "off" }), "off");
    assert.equal(stepUpMode({ ADMIN_STEP_UP: "OBSERVE" }), "observe");
    assert.equal(stepUpMode({ ADMIN_STEP_UP: "enforce" }), "enforce");
  });

  it("observe logs would-require-step-up without secrets and allows", async () => {
    const { requireStepUp } = await load();
    const lines = [];
    const orig = console.info;
    console.info = (...args) => { lines.push(args.map(String).join(" ")); };
    try {
      requireStepUp(
        { action: "did-pool:assign_specific", operator: "alvin", target: "biz:1" },
        { ADMIN_STEP_UP: "observe" },
      );
    } finally {
      console.info = orig;
    }
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.event, "would-require-step-up");
    assert.equal(payload.action, "did-pool:assign_specific");
    assert.equal(payload.operator, "alvin");
    assert.equal(payload.target, "biz:1");
    assert.equal("accessCode" in payload, false);
    assert.equal("cookie" in payload, false);
    assert.equal("secret" in payload, false);
  });

  it("off is silent; enforce throws not implemented", async () => {
    const { requireStepUp } = await load();
    const lines = [];
    const orig = console.info;
    console.info = (...args) => { lines.push(args); };
    try {
      requireStepUp({ action: "x", operator: "a" }, { ADMIN_STEP_UP: "off" });
      assert.equal(lines.length, 0);
      assert.throws(
        () => requireStepUp({ action: "x", operator: "a" }, { ADMIN_STEP_UP: "enforce" }),
        /not implemented/,
      );
    } finally {
      console.info = orig;
    }
  });
});
