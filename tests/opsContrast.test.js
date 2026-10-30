// Ops layer (OPS.md §2): every status fg on its bg, and on the surfaces it sits on, is 4.5:1+ in both themes.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const ops = fs.readFileSync(path.join(root, "dashboard/src/styles/ops.css"), "utf8");
const globals = fs.readFileSync(path.join(root, "dashboard/src/app/globals.css"), "utf8");

function lum(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const block = (css, sel) => { const at = css.indexOf(sel); assert.ok(at >= 0, sel); return css.slice(at, css.indexOf("}", at)); };
function token(src, name) {
  const m = src.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} defined`);
  return m[1];
}
const TONES = ["ok", "info", "warn", "danger", "neutral", "beta"];
const themes = [
  ["light", block(ops, ".ops-theme {"), block(globals, ":root {")],
  ["dark", block(ops, ':root[data-theme="dark"] .ops-theme'), block(globals, ':root[data-theme="dark"]')],
];

describe("ops status contrast", () => {
  for (const [name, src, base] of themes) {
    it(`${name}: pill fg on its own bg`, () => {
      for (const t of TONES) {
        const r = ratio(token(src, `ops-status-${t}-fg`), token(src, `ops-status-${t}-bg`));
        assert.ok(r >= 4.5, `${name} ${t} is ${r.toFixed(2)}:1`);
      }
    });
    it(`${name}: danger and ok text on canvas and surface`, () => {
      for (const t of ["ok", "danger"]) for (const bg of ["canvas", "surface"]) {
        const r = ratio(token(src, `ops-status-${t}-fg`), token(base, bg));
        assert.ok(r >= 4.5, `${name} ${t} on ${bg} is ${r.toFixed(2)}:1`);
      }
    });
  }
  it("ops-field: 44px tall, border 3:1 on surface in both themes", () => {
    assert.match(block(ops, ".ops-field {"), /min-height:\s*44px/);
    for (const [name, , base] of themes) {
      const r = ratio(token(base, "ink-3"), token(base, "surface"));
      assert.ok(r >= 3, `${name} field border is ${r.toFixed(2)}:1`);
    }
  });
  it("system-dark block matches the explicit dark block", () => {
    const sys = block(ops, ':root:not([data-theme="light"]) .ops-theme');
    for (const t of TONES) for (const k of ["fg", "bg"]) {
      assert.equal(token(sys, `ops-status-${t}-${k}`), token(themes[1][1], `ops-status-${t}-${k}`));
    }
  });
  it("light warn is amber, not orange", () => {
    assert.equal(token(block(ops, ".ops-theme {"), "ops-status-warn-fg"), "8a5a00");
    assert.equal(token(block(ops, ".ops-theme {"), "ops-status-warn-bg"), "fff5d6");
    assert.equal(token(block(globals, ":root {"), "warn"), "8a5a00");
    assert.equal(token(block(globals, ":root {"), "status-warn-fg"), "8a5a00");
    assert.notEqual(token(block(globals, ":root {"), "attention"), "b13a0a");
  });
  it("no hex in ops components", () => {
    const dir = path.join(root, "dashboard/src/components/ops");
    for (const f of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /#[0-9a-fA-F]{3,6}\b/, f);
  });
});
