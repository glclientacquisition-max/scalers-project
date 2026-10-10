/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/lengthLimits.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { faqsLengthError, lexiconLengthError, policiesLengthError } from "../dashboard/src/lib/lengthLimits.ts";

it("policies over 500 chars error instead of being cut", () => {
  assert.match(String(policiesLengthError(JSON.stringify({ returns: "x".repeat(501) }), { returns: "Returns" })), /^Returns: 501/);
  assert.equal(policiesLengthError({ returns: "x".repeat(500) }), null);
});
it("FAQ answer over 400 chars errors", () => {
  assert.match(String(faqsLengthError(JSON.stringify([{ question: "Q", answer: "a".repeat(401) }]))), /FAQ 1: answer/);
  assert.equal(faqsLengthError([{ question: "Q", answer: "ok" }]), null);
});
it("pronunciation entry too long errors instead of 'Saved' with nothing stored", () => {
  assert.ok(lexiconLengthError(JSON.stringify([{ match: "w".repeat(81), say: "x" }])));
  assert.ok(lexiconLengthError([{ match: "Kiambu", say: "k".repeat(121) }]));
  assert.equal(lexiconLengthError([{ match: "Kiambu", say: "kee-AM-boo" }]), null);
});
