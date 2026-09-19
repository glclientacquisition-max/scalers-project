const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const helperPath = path.join(__dirname, "../dashboard/src/lib/polishInboxSms.ts");

function loadFallback(samples) {
  const script = `
    import { fallbackPolishInboxDraft } from ${JSON.stringify(helperPath)};
    const samples = ${JSON.stringify(samples)};
    const results = samples.map((raw) => fallbackPolishInboxDraft(raw));
    console.log(JSON.stringify(results));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("inbox SMS draft polish", () => {
  it("does not invent a message from an empty draft", () => {
    const [empty, spaces, quotes] = loadFallback(["", "   ", "   \n\t  "]);
    assert.equal(empty, "");
    assert.equal(spaces, "");
    assert.equal(quotes, "");
  });

  it("collapses whitespace and sentence-cases without adding a greeting", () => {
    const [tidy, already, sw] = loadFallback([
      "  tuesday 2pm  instead  ",
      "Please bring the order to Gate 2.",
      "sawa, nitafika kesho asubuhi",
    ]);
    assert.equal(tidy, "Tuesday 2pm instead");
    assert.equal(already, "Please bring the order to Gate 2.");
    assert.equal(sw, "Sawa, nitafika kesho asubuhi");
    assert.doesNotMatch(tidy, /^Hi /);
    assert.doesNotMatch(sw, /here\./);
  });

  it("keeps the rewrite prompt free of greeting fluff", () => {
    const src = fs.readFileSync(helperPath, "utf8");
    assert.match(src, /export const POLISH_INBOX_DRAFT_SYSTEM/);
    assert.match(src, /same language/);
    assert.match(src, /Do not add a greeting/);
    assert.doesNotMatch(src, /Hi \{Name\}/);
    assert.doesNotMatch(src, /The team will follow up/);
    assert.doesNotMatch(src, /[\u2014\u2013]/);
  });
});
