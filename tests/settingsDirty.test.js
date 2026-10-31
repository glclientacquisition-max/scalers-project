const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/settingsDirty.ts");
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

describe("useDirty", () => {
  it("is clean when nothing changed, including empty-string and null", () => {
    assert.equal(load(`mod.useDirty({ name: "Ada", note: null }, { name: "Ada", note: "" })`), 0);
    assert.equal(load(`mod.useDirty(["a", "b"], ["a", "b"])`), 0);
  });

  it("counts changed fields, not a single dirty flag", () => {
    assert.equal(
      load(`mod.useDirty({ hours: "9-5", phone: "0700", note: "" }, { hours: "8-4", phone: "0711", note: "x" })`),
      3
    );
    assert.equal(load(`mod.useDirty(["mon", "tue"], ["mon", "wed"])`), 1);
    assert.equal(load(`mod.useDirty("open", "closed")`), 1);
  });
});
