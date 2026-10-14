'use strict';

// BRAIN_TRUST_P1 (Voice-side, small): a short caller final that repeats a
// line the agent spoke in the last few seconds is our own audio coming back
// (HD_35b75499d483: the greeting's "Karibu tena." arrived as a caller turn
// after the next line had started). The existing gate only compared the
// current line; this keeps the last few agent lines with timestamps.

const WINDOW_MS = 8000;
const MAX_LINES = 4;

function norm(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function createEchoGate({ windowMs = WINDOW_MS } = {}) {
  const lines = [];
  return {
    remember(text, at = Date.now()) {
      const n = norm(text);
      if (!n) return;
      lines.push({ n, at });
      while (lines.length > MAX_LINES) lines.shift();
    },
    /** True when `text` (≤6 words) is contained in an agent line spoken within the window. */
    isEcho(text, at = Date.now()) {
      const c = norm(text);
      if (!c) return false;
      const words = c.split(' ');
      // ≥2 words: a one-word answer ("Tomorrow.") to an offered choice is real speech.
      if (words.length < 2 || words.length > 6 || c.length < 8) return false;
      // Older lines only: an answer to the latest line may legitimately repeat
      // its words; the existing turn-taking gate already handles that line.
      const older = lines.slice(0, -1);
      return older.some((l) => at - l.at <= windowMs && (` ${l.n} `).includes(` ${c} `));
    },
  };
}

module.exports = { createEchoGate, WINDOW_MS };
