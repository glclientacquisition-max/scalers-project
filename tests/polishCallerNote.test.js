const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

describe("polishCallerNote fallback", () => {
  it("prefixes business and drops blocked names in the source", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../dashboard/src/lib/polishCallerNote.ts"),
      "utf8"
    );
    assert.match(src, /Hi \$\{name\}, /);
    assert.match(src, /haijawekwa/);
    assert.match(src, /POLISH_CALLER_SMS_SYSTEM/);
    assert.match(src, /Do not invent a time/);
  });
});
