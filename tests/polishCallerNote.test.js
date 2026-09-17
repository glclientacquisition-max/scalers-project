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
    assert.match(src, /NOTHING_TO_SEND/);
  });
});

describe("caller reply draft from facts", () => {
  async function load() {
    return import("../dashboard/src/lib/polishCallerNote.ts");
  }

  it("drafts the callback line for a missed call with an empty note", async () => {
    const { fallbackPolishCallerNote } = await load();
    assert.equal(
      fallbackPolishCallerNote({
        note: "",
        businessName: "Scalers Cleaning",
        callerName: "Alvin",
        purpose: "missed",
      }),
      "Hi Alvin, Scalers Cleaning here. The team will call you back."
    );
  });

  it("drafts the callback line for a human ask with an empty note", async () => {
    const { fallbackPolishCallerNote } = await load();
    assert.equal(
      fallbackPolishCallerNote({
        note: "",
        businessName: "Scalers Cleaning",
        callerName: "Amina",
        purpose: "human",
      }),
      "Hi Amina, Scalers Cleaning here. The team will call you back."
    );
  });

  it("drafts the visit received line from job facts", async () => {
    const { fallbackPolishCallerNote } = await load();
    assert.equal(
      fallbackPolishCallerNote({
        note: "",
        businessName: "Scalers Cleaning",
        callerName: "Otieno",
        purpose: "job",
        service: "House cleaning",
        when: "Tomorrow 9am",
      }),
      "Hi Otieno, Scalers Cleaning here. We have your House cleaning visit for Tomorrow 9am. We will confirm shortly."
    );
  });

  it("refuses an answered enquiry with no owner note", async () => {
    const { fallbackPolishCallerNote, canDraftCallerNote } = await load();
    assert.equal(canDraftCallerNote({ purpose: "answered" }), false);
    assert.equal(
      fallbackPolishCallerNote({
        note: "",
        businessName: "Scalers Cleaning",
        callerName: "Brian",
        purpose: "answered",
      }),
      ""
    );
  });

  it("still rewrites an owner note and ignores blocked names", async () => {
    const { fallbackPolishCallerNote } = await load();
    assert.equal(
      fallbackPolishCallerNote({
        note: "Tuesday 2pm instead",
        businessName: "Scalers Cleaning",
        callerName: "caller",
        purpose: "missed",
      }),
      "Hi, Scalers Cleaning here. Tuesday 2pm instead"
    );
  });

  it("treats NOTHING_TO_SEND as an empty body", async () => {
    const { stripModelSms } = await load();
    assert.equal(stripModelSms("NOTHING_TO_SEND"), "");
  });
});
