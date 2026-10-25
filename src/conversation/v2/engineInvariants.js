'use strict';
// Per-turn invariants for BRAIN_ENGINES scenarios.
const SENT_SPLIT = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;

function sentences(line) {
  return (String(line || '').match(SENT_SPLIT) || []).map((x) => x.trim()).filter(Boolean);
}

function assertTurnInvariants({ line, lang, prior = [] }) {
  const issues = [];
  const parts = sentences(line);
  if (parts.length > 2 && !/\b(booking|miadi|read back|nimekuwekea)\b/i.test(line)) {
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

module.exports = { assertTurnInvariants, sentences };
