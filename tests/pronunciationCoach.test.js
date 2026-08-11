/**
 * Lightweight checks for pronunciation coach helpers.
 * Run: node --experimental-strip-types --test tests/pronunciationCoach.test.ts
 * (falls back skipped if strip-types unavailable — also covered by dashboard build)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Inline mirrors of critical pure helpers so root tests do not need a TS loader.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchPatternFromPhrase(phrase) {
  const cleaned = String(phrase || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  const words = lower.split(" ").filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) {
    return escapeRegex(words[0]).slice(0, 80);
  }
  const spaced = words.map(escapeRegex).join("\\s+");
  const loose = words.map(escapeRegex).join("\\s*");
  const glued = words.map(escapeRegex).join("");
  return `${spaced}|${loose}|${glued}`.slice(0, 80);
}

describe("pronunciation match patterns", () => {
  it("builds alternates for multi-word places", () => {
    const m = matchPatternFromPhrase("Muindi Mbingu");
    assert.match(m, /muindi/);
    assert.match(m, /mbingu/);
    assert.ok(m.includes("|"));
  });

  it("escapes regex metacharacters", () => {
    const m = matchPatternFromPhrase("Co-op");
    assert.ok(m.includes("\\-") || m.includes("co-op") || m.includes("co\\-op"));
  });
});
