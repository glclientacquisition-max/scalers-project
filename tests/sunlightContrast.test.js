// Sunlight pass: numbers sit on near-black ink, warnings stay amber, buttons stay blue.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const globals = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/app/globals.css"), "utf8");
const light = globals.slice(globals.indexOf(":root {"), globals.indexOf("}", globals.indexOf(":root {")));

function hex(name) {
  const m = light.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(m, name);
  return m[1];
}
function lum(h) {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => p - q);
  return (y + 0.05) / (x + 0.05);
}

test("light ink on white is strong enough for a bright phone", () => {
  assert.ok(ratio(hex("ink"), hex("surface")) >= 12, "ink on surface");
  assert.equal(hex("accent"), "005ccc");
  assert.equal(hex("warn"), "8a5a00");
  assert.equal(hex("status-warn-bg"), "fff5d6");
  assert.ok(ratio(hex("warn"), hex("status-warn-bg")) >= 4.5);
  assert.notEqual(hex("attention"), "b13a0a");
});
