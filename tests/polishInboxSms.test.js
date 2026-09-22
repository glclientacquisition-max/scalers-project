const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const helperPath = path.join(__dirname, "../dashboard/src/lib/polishInboxSms.ts");

function load(scriptBody) {
  const script = `
    import {
      emptyInboxSmsFacts,
      fallbackPolishInboxDraft,
      fallbackSuggestInboxSms,
    } from ${JSON.stringify(helperPath)};
    ${scriptBody}
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
    const [empty, spaces, quotes] = load(`
      const samples = ${JSON.stringify(["", "   ", "   \n\t  "])};
      console.log(JSON.stringify(samples.map((raw) => fallbackPolishInboxDraft(raw))));
    `);
    assert.equal(empty, "");
    assert.equal(spaces, "");
    assert.equal(quotes, "");
  });

  it("collapses whitespace and sentence-cases without adding a greeting", () => {
    const [tidy, already, sw] = load(`
      console.log(JSON.stringify([
        fallbackPolishInboxDraft("  tuesday 2pm  instead  "),
        fallbackPolishInboxDraft("Please bring the order to Gate 2."),
        fallbackPolishInboxDraft("sawa, nitafika kesho asubuhi"),
      ]));
    `);
    assert.equal(tidy, "Tuesday 2pm instead");
    assert.equal(already, "Please bring the order to Gate 2.");
    assert.equal(sw, "Sawa, nitafika kesho asubuhi");
    assert.doesNotMatch(tidy, /^Hi /);
    assert.doesNotMatch(sw, /here\./);
  });

  it("keeps the rewrite prompt free of greeting fluff", () => {
    const src = fs.readFileSync(helperPath, "utf8");
    const start = src.indexOf("export const POLISH_INBOX_DRAFT_SYSTEM");
    const end = src.indexOf("export const SUGGEST_INBOX_SMS_SYSTEM");
    const polish = src.slice(start, end);
    assert.match(polish, /Do not add a greeting/);
    assert.doesNotMatch(polish, /Hi \{Name\}/);
    assert.doesNotMatch(polish, /[\u2014\u2013]/);
    assert.match(src, /export const SUGGEST_INBOX_SMS_SYSTEM/);
    assert.match(src, /Package: Hi \{Name\}, \{Business\} here/);
  });
});

describe("inbox SMS suggest pack", () => {
  it("packages a requested visit without saying booked", () => {
    const text = load(`
      const facts = {
        ...emptyInboxSmsFacts(),
        businessName: "Done and Dusted",
        callerName: "Amina",
        jobStatus: "requested",
        jobService: "carpet cleaning",
        jobWhen: "Saturday 9",
      };
      console.log(JSON.stringify(fallbackSuggestInboxSms(facts)));
    `);
    assert.match(text, /^Hi Amina, Done and Dusted here\./);
    assert.match(text, /carpet cleaning/);
    assert.match(text, /Saturday 9/);
    assert.match(text, /We will confirm shortly/);
    assert.doesNotMatch(text, /booked|confirmed/i);
  });

  it("packages an open hold without saying ready", () => {
    const text = load(`
      const facts = {
        ...emptyInboxSmsFacts(),
        businessName: "Westlands Books",
        callerName: "Brian",
        holdStatus: "open",
        holdType: "hold",
        holdItem: "Atomic Habits",
        holdWhen: "Friday 5",
      };
      console.log(JSON.stringify(fallbackSuggestInboxSms(facts)));
    `);
    assert.match(text, /^Hi Brian, Westlands Books here\./);
    assert.match(text, /Atomic Habits/);
    assert.doesNotMatch(text, /ready/i);
  });

  it("packages a human ask as a callback", () => {
    const text = load(`
      const facts = {
        ...emptyInboxSmsFacts(),
        businessName: "Done and Dusted",
        callerName: "Jane",
        purpose: "human",
      };
      console.log(JSON.stringify(fallbackSuggestInboxSms(facts)));
    `);
    assert.equal(
      text,
      "Hi Jane, Done and Dusted here. The team will call you back."
    );
  });

  it("returns empty when there is nothing true to send", () => {
    const text = load(`
      console.log(JSON.stringify(fallbackSuggestInboxSms(emptyInboxSmsFacts())));
    `);
    assert.equal(text, "");
  });
});
