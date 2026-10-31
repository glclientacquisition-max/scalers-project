const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/serviceAreas.ts");
  const script = `
    import * as mod from ${JSON.stringify(file)};
    const value = ${expr};
    process.stdout.write(JSON.stringify(value));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
}

describe("locations reach default", () => {
  it("goes to customers only for a home service that never chose", () => {
    assert.equal(load(`mod.defaultNoPremises({}, "home_services", 3)`), true);
    assert.equal(load(`mod.defaultNoPremises({ no_premises: false }, "home_services", 3)`), false);
    assert.equal(load(`mod.defaultNoPremises({ no_premises: true }, "retail", 0)`), true);
    assert.equal(load(`mod.defaultNoPremises({}, "retail", 4)`), false);
    assert.equal(load(`mod.defaultNoPremises({}, "home_services", 0)`), false);
  });
});
