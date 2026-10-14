'use strict';

// BRAIN_TRUST_P1 (Voice-side, small): a short caller final that repeats a
// line the agent spoke is our own audio coming back (HD_35b75499d483: the
// greeting's "Karibu tena." arrived as a caller turn).
//
// Safety rules (caller-names design, Voice input §3):
//  - never while a name / identity-confirm ask is pending (answers repeat it);
//  - only during or just after the agent's playback, not on a wall clock;
//  - 2 words: exact phrase inside an agent sentence; 3+ words: must equal a
//    whole agent sentence (so "with Alvin" never matches "Am I speaking with Alvin?");
//  - never a name-led phrase ("my name is", "naitwa", "ni mimi", ...).

const AFTER_PLAYBACK_MS = 2500;
const MAX_LINES = 4;
const NAME_LED = /^(?:(?:yes|yeah|ndio|ndiyo|eeh)[, ]+)?(?:my name is|my name's|i am|i'm|this is|it's|it is|jina langu ni|naitwa|mimi ni|ni mimi|speaking)\b/i;

function norm(t) {
  return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function sentencesOf(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map(norm).filter(Boolean);
}

function createEchoGate({ afterPlaybackMs = AFTER_PLAYBACK_MS } = {}) {
  const lines = [];
  return {
    /** Remember an agent line when its playback starts (and again when it ends). */
    remember(text, at = Date.now()) {
      const n = norm(text);
      if (!n) return;
      const last = lines[lines.length - 1];
      if (last && last.n === n) { last.at = at; return; }
      lines.push({ n, sentences: sentencesOf(text), at });
      while (lines.length > MAX_LINES) lines.shift();
    },
    /**
     * True when `text` is an echo of agent playback.
     * opts.speaking: agent audio is playing now. opts.exempt: a name/confirm ask is pending.
     */
    isEcho(text, { at = Date.now(), speaking = false, exempt = false } = {}) {
      if (exempt) return false;
      const raw = String(text || '').trim();
      if (!raw || NAME_LED.test(raw)) return false;
      const c = norm(raw);
      const words = c.split(' ').filter(Boolean);
      if (words.length < 2 || words.length > 6 || c.length < 8) return false;
      const last = lines[lines.length - 1];
      if (!last) return false;
      if (!speaking && at - last.at > afterPlaybackMs) return false;
      // Older lines only: an answer to the latest line may repeat its words.
      const older = lines.slice(0, -1);
      return older.some((l) => {
        if (words.length >= 3) return l.sentences.includes(c);
        return (` ${l.n} `).includes(` ${c} `);
      });
    },
  };
}

module.exports = { createEchoGate, AFTER_PLAYBACK_MS, NAME_LED };
