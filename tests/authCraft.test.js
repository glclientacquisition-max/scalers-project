const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("auth craft", () => {
  const login = read("dashboard/src/app/login/page.tsx");
  const signup = read("dashboard/src/app/signup/page.tsx");
  const form = read("dashboard/src/app/signup/SignupForm.tsx");

  it("offers a muted Scalers home link and tokenized login accents", () => {
    assert.match(login, /marketingHomeHref\(\)/); // host-aware home link (marketing vs app host)
    assert.match(login, /href=\{homeHref\}/);
    assert.match(login, />\s*Scalers home\s*</);
    assert.match(login, /text-ink-2/); // Frontend 2.0 ink tokens
    assert.doesNotMatch(login, /text-\[#005CCC\]/);
  });

  it("drops signup phone fluff and tokenizes accents", () => {
    assert.doesNotMatch(form, /Lead alerts go here/);
    assert.match(form, /text-accent-deep/);
    assert.doesNotMatch(form, /text-\[#005CCC\]/);
    assert.match(signup, /text-accent-deep/);
    assert.doesNotMatch(signup, /text-\[#005CCC\]/);
  });
});
