'use strict';
// Per-turn invariants for BRAIN_ENGINES scenarios.
const SENT_SPLIT = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;

function sentences(line) {
  return (String(line || '').match(SENT_SPLIT) || []).map((x) => x.trim()).filter(Boolean);
}

function isReadbackOrBooked(line) {
  return /\b(Ni sawa\?|Shall I ask the owner|Nimwombe mwenye|nimekuwekea|booked|miadi yako|read back)\b/i.test(String(line || ''));
}

function capSpokenLine(line, { readbackOrBooked = false } = {}) {
  const s = String(line || '').trim();
  if (!s || readbackOrBooked || isReadbackOrBooked(s)) return s;
  const parts = sentences(s);
  if (parts.length <= 2) return s;
  return parts.slice(0, 2).join(' ');
}

function assertTurnInvariants({ line, lang, prior = [], allowReadback = false }) {
  const issues = [];
  const parts = sentences(line);
  const exempt = allowReadback || isReadbackOrBooked(line);
  if (parts.length > 2 && !exempt) {
    issues.push(`more_than_two_sentences:${parts.length}`);
  }
  const hasEn = /\b(the|we|you|shall|would|how)\b/i.test(line);
  const hasSw = /\b(tuna|tunafika|ungependa|naomba|sawa|ndio)\b/i.test(line);
  if (hasEn && hasSw && parts.length > 1) issues.push('mixed_language');
  if (lang === 'sw' && hasEn && !hasSw) issues.push('lang_mismatch_sw');
  if (lang === 'en' && hasSw && !hasEn) issues.push('lang_mismatch_en');
  for (const p of prior) {
    if (p && line && p.trim() === line.trim()) issues.push('duplicate_utterance');
  }
  return issues;
}

module.exports = { assertTurnInvariants, sentences, capSpokenLine, isReadbackOrBooked };
