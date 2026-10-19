'use strict';
// Whole-sentence linter for spoken lines (bug E, HD_9939ca74d492).
// A spoken sentence may not start lower-case, start with a dangling
// preposition, or be shorter than three words, unless it is an allow-listed ack.

const ACKS = new Set([
  'ok',
  'okay',
  'okay.',
  'sawa',
  'sawa.',
  'yes',
  'yes.',
  'ndio',
  'ndio.',
  'ndiyo',
  'poa',
  'poa.',
  'alright',
  'alright.',
  'thanks',
  'thanks.',
  'asante',
  'asante.',
  'hello',
  'hi',
  'haya',
  'sure',
]);

const DANGLING = /^(with|to|for|from|and|or|but|of|na|ya|kwa|hadi)\b/i;

function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @returns {null | 'short' | 'lowercase_start' | 'dangling'} */
function lintSentence(sentence) {
  const raw = String(sentence || '').trim();
  if (!raw) return null;
  if (ACKS.has(raw.toLowerCase())) return null;
  const words = raw.replace(/[.!?]+$/g, '').split(/\s+/).filter(Boolean);
  if (words.length < 3 && ACKS.has(words.join(' ').toLowerCase())) return null;
  if (words.length < 3) return 'short';
  if (/^[a-z]/.test(raw)) return 'lowercase_start';
  if (DANGLING.test(raw)) return 'dangling';
  return null;
}

/** First failure across the line, or null. */
function lintLine(text) {
  for (const sentence of sentencesOf(text)) {
    const fault = lintSentence(sentence);
    if (fault) return { fault, sentence };
  }
  return null;
}

module.exports = { lintSentence, lintLine, sentencesOf, ACKS };
