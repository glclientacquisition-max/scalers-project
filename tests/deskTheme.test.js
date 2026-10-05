const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseDeskTheme, readDeskThemeCookie } = require("../dashboard/src/lib/deskTheme.ts");

describe("desk theme cookie", () => {
  it("reads light or dark from a cookie header and treats anything else as system", () => {
    assert.equal(readDeskThemeCookie("scalers-desk-theme=dark"), "dark");
    assert.equal(readDeskThemeCookie("foo=1; scalers-desk-theme=light; bar=2"), "light");
    assert.equal(readDeskThemeCookie("scalers-desk-theme=system"), "system");
    assert.equal(readDeskThemeCookie(""), "system");
    assert.equal(parseDeskTheme("dark"), "dark");
    assert.equal(parseDeskTheme("nope"), "system");
  });
});
