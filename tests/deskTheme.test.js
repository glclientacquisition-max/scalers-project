const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseDeskTheme, readDeskThemeCookie, DESK_THEME_COLOR_LIGHT, DESK_THEME_COLOR_DARK } = require("../dashboard/src/lib/deskTheme.ts");

describe("desk theme cookie", () => {
  it("reads light or dark from a cookie header and treats anything else as system", () => {
    assert.equal(readDeskThemeCookie("scalers-desk-theme=dark"), "dark");
    assert.equal(readDeskThemeCookie("foo=1; scalers-desk-theme=light; bar=2"), "light");
    assert.equal(readDeskThemeCookie("scalers-desk-theme=system"), "system");
    assert.equal(readDeskThemeCookie(""), "system");
    assert.equal(parseDeskTheme("dark"), "dark");
    assert.equal(parseDeskTheme("nope"), "system");
  });

  it("exports Safari theme-color from the canvas tokens, not brand", () => {
    const css = require("fs").readFileSync(require("path").join(__dirname, "../dashboard/src/app/globals.css"), "utf8");
    assert.match(css, new RegExp(`--canvas:\\s*${DESK_THEME_COLOR_LIGHT}`));
    assert.match(css, new RegExp(`--canvas:\\s*${DESK_THEME_COLOR_DARK}`));
    assert.equal(DESK_THEME_COLOR_LIGHT, "#f4f7fb");
    assert.equal(DESK_THEME_COLOR_DARK, "#0b1220");
  });
});
