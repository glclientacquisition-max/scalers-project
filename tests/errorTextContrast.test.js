// Error and warning text uses the attention token. In light mode it sat at ~4.3:1 on
// grouped settings rows (surface-2). WCAG AA small text needs 4.5:1 on every surface it lands on.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "dashboard/src/app/globals.css"), "utf8");

function lum(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function block(sel) {
  const at = css.indexOf(sel);
  return css.slice(at, css.indexOf("}", at));
}
function token(src, name) {
  const m = src.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} defined`);
  return m[1];
}

describe("attention (error) text contrast", () => {
  const light = block(":root {");
  const dark = block(':root[data-theme="dark"]');
  for (const [name, src] of [["light", light], ["dark", dark]]) {
    it(`${name}: 4.5:1 on canvas, surfaces and its tonal wash`, () => {
      const fg = token(src, "attention");
      for (const bg of ["canvas", "surface", "surface-2", "attention-tonal"]) {
        const r = ratio(fg, token(src, bg));
        assert.ok(r >= 4.5, `${name} attention on ${bg} is ${r.toFixed(2)}:1`);
      }
    });
  }

  it("MASTER documents the same light value", () => {
    const master = fs.readFileSync(path.join(root, "docs/frontend/design-system/MASTER.md"), "utf8");
    assert.ok(master.toLowerCase().includes(`#${token(light, "attention").toLowerCase()}`));
  });

  it("no error text uses an undefined danger colour", () => {
    const src = fs.readFileSync(path.join(root, "dashboard/src/components/structured/ServiceAreasEditor.tsx"), "utf8");
    assert.doesNotMatch(src, /text-danger/);
  });
});
