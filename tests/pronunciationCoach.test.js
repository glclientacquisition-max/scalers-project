/**
 * Lightweight checks for pronunciation coach helpers.
 * Run: node --test tests/pronunciationCoach.test.js
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localAudioLikelyMatches(opts) {
  const heard = normalizeForCompare(opts.heard);
  if (!heard || heard.length < 2) return false;
  const prompt = normalizeForCompare(opts.prompt);
  if (!prompt) return false;
  const promptTokens = prompt.split(" ").filter((t) => t.length > 2);
  const heardSet = new Set(heard.split(" "));
  const overlap = promptTokens.filter((t) => heardSet.has(t)).length;
  if (promptTokens.length && overlap / promptTokens.length >= 0.45) {
    return true;
  }
  const targets = opts.targets || [];
  if (targets.length) {
    const heardCompact = heard.replace(/\s+/g, "");
    return targets.some((t) => {
      const label = normalizeForCompare(t.label).replace(/\s+/g, "");
      return label.length >= 3 && heardCompact.includes(label);
    });
  }
  return false;
}

describe("pronunciation recording guardrails", () => {
  it("accepts a close take of the asked line", () => {
    assert.equal(
      localAudioLikelyMatches({
        prompt: "Hi, this is Aisha from ChapterOne Bookstore",
        heard: "hi this is aisha from chapterone bookstore",
        targets: [
          { label: "Aisha", match: "aisha" },
          { label: "ChapterOne Bookstore", match: "chapterone" },
        ],
      }),
      true
    );
  });

  it("rejects a totally different utterance", () => {
    assert.equal(
      localAudioLikelyMatches({
        prompt: "Hi, this is Aisha from ChapterOne Bookstore",
        heard: "sugar water please",
        targets: [
          { label: "Aisha", match: "aisha" },
          { label: "ChapterOne Bookstore", match: "chapterone" },
        ],
      }),
      false
    );
  });
});
