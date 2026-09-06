const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Mirrors dashboard/src/lib/inboxPurpose.ts classify + needsYou.
 * Keep in lockstep when changing purpose stamps.
 */
const JOB_INTENTS = new Set(["book_visit", "booking", "reschedule", "cancel", "cancellation"]);
const HOLD_INTENTS = new Set(["hold", "order", "enquiry", "callback"]);
const HUMAN_INTENTS = new Set(["human", "emergency", "complaint", "escalate", "handoff"]);
const ANSWER_INTENTS = new Set([
  "hours",
  "hours_open",
  "location",
  "directions",
  "price",
  "price_band",
  "availability",
  "policy",
  "service_inquiry",
  "service_area",
  "other",
]);

function classify({ primaryIntent, resolution, leadStatus, hold, job }) {
  if (job) return "job";
  if (hold) return "hold";
  const intent = String(primaryIntent || "").trim().toLowerCase();
  if (HUMAN_INTENTS.has(intent) || resolution === "needs_human") return "human";
  if (JOB_INTENTS.has(intent)) return "job";
  if (HOLD_INTENTS.has(intent)) return "hold";
  if (resolution === "abandoned" || resolution === "unresolved") return "missed";
  if (resolution === "resolved" || ANSWER_INTENTS.has(intent)) return "answered";
  if (leadStatus === "new") return "missed";
  return "answered";
}

describe("inbox purpose", () => {
  it("stamps a visit row as job over hold", () => {
    assert.equal(
      classify({
        hold: { id: "r1" },
        job: { id: "a1" },
      }),
      "job"
    );
  });

  it("stamps an open hold from the request row", () => {
    assert.equal(classify({ hold: { id: "r1" } }), "hold");
  });

  it("stamps escalate as human", () => {
    assert.equal(classify({ resolution: "needs_human" }), "human");
  });

  it("stamps hours as answered", () => {
    assert.equal(classify({ primaryIntent: "hours", resolution: "resolved" }), "answered");
  });

  it("stamps abandoned as missed", () => {
    assert.equal(classify({ resolution: "abandoned" }), "missed");
  });
});
