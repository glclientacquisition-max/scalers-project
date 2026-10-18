/**
 * summary.topic contract (Brain #751, CALLER_IDENTITY_AND_SUMMARY.md §2).
 * Run: node --experimental-strip-types --no-warnings --test tests/ownerTopic.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { followUpWhatsAppText, summaryTopic } from "../dashboard/src/lib/ownerTopic.ts";

const GENERIC = "Hi Jane, this is Esga. Thanks for calling. How can we help you?";
const REASON = "Caller asked about apartment cleaning services.";

describe("summaryTopic", () => {
  it("string topic is used", () => {
    assert.equal(summaryTopic({ topic: "carpet cleaning", reason: REASON }), "carpet cleaning");
  });
  it("mirror in owner_review when the top-level key is missing", () => {
    assert.equal(summaryTopic({ owner_review: { topic: "JK copy paper and more" } }), "JK copy paper and more");
  });
  it("null topic: no topic, no fallback to owner_review, reason, goal or brain_summary", () => {
    assert.equal(
      summaryTopic({ topic: null, owner_review: { topic: "x" }, reason: REASON, goal: { text: "cleaning" }, brain_summary: "Cleaning" }),
      null
    );
  });
  it("missing topic: no fallback to reason, goal or brain_summary", () => {
    assert.equal(summaryTopic({ reason: REASON, goal: { text: "cleaning" }, brain_summary: "Cleaning" }), null);
    assert.equal(summaryTopic(null), null);
  });
  it("empty or non-string topic is no topic", () => {
    assert.equal(summaryTopic({ topic: "   " }), null);
    assert.equal(summaryTopic({ topic: 42 }), null);
  });
});

describe("followUpWhatsAppText", () => {
  it("string topic: 'Thanks for calling about {topic}.'", () => {
    const text = followUpWhatsAppText({ businessName: "Esga", name: "Jane", topic: summaryTopic({ topic: "carpet cleaning" }) });
    assert.match(text, /Thanks for calling about carpet cleaning\./);
  });
  it("null topic: generic opener, never the reason", () => {
    const text = followUpWhatsAppText({ businessName: "Esga", name: "Jane", topic: summaryTopic({ topic: null, reason: REASON }) });
    assert.equal(text, GENERIC);
    assert.doesNotMatch(text, /apartment/);
  });
  it("missing topic: generic opener, never the reason", () => {
    const text = followUpWhatsAppText({ businessName: "Esga", name: "Jane", topic: summaryTopic({ reason: REASON }) });
    assert.equal(text, GENERIC);
  });
});
