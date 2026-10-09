'use strict';

// Cross-language filler words in a language-locked say[] sentence.
//
// Staging 5bbb0871 (HD_b82fbfef7649) turn 13: the lock was English and the
// model said "Okay, Sawa." The sentence is too short for the language check
// (one Kiswahili marker word), so it went out as is. A filler word carries
// no content, so the fix is to rewrite or drop the word, not regenerate the
// turn:
//   en lock: sawa / poa -> "Okay" (dropped next to another okay),
//            ndio / ndiyo -> "Yes", eeh / ehe -> dropped.
// sw / sheng locks: "okay" stays (an ordinary Kenyan filler that the
// language lock already treats as neutral, languageLock.js FILLERS).

const EN_REWRITE = new Map([
  ['sawa', 'okay'],
  ['poa', 'okay'],
  ['ndio', 'yes'],
  ['ndiyo', 'yes'],
  ['eeh', ''],
  ['ehe', ''],
  ['eh', ''],
]);

const TOKEN = /[\p{L}']+|[^\p{L}']+/gu;

function capitalizeLike(word, source) {
  if (!word) return word;
  return /^\p{Lu}/u.test(source) ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * @param {string} sentence
 * @param {'en'|'sw'|'sheng'} locked
 * @returns {{ text: string, changed: boolean, words: string[] }}
 */
function rewriteCrossLanguageFillers(sentence, locked) {
  const original = String(sentence || '');
  if (locked !== 'en') return { text: original, changed: false, words: [] };
  const parts = original.match(TOKEN) || [];
  const words = [];
  const out = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (/^[\p{L}']+$/u.test(part) && EN_REWRITE.has(key)) {
      words.push(key);
      out.push({ word: EN_REWRITE.get(key), source: part, rewritten: true });
    } else if (/^[\p{L}']+$/u.test(part)) {
      out.push({ word: part, source: part, rewritten: false });
    } else {
      out.push({ sep: part });
    }
  }
  if (!words.length) return { text: original, changed: false, words };

  // Drop emptied words and a filler that repeats the word before it
  // ("Okay, okay." -> "Okay.").
  const kept = [];
  let lastWord = null;
  for (const item of out) {
    if (item.sep != null) {
      kept.push(item);
      continue;
    }
    if (item.rewritten && (!item.word || (lastWord && lastWord.toLowerCase() === item.word))) {
      // Remove the separator that led into the dropped word.
      if (kept.length && kept[kept.length - 1].sep != null) kept.pop();
      continue;
    }
    kept.push(item);
    lastWord = item.word;
  }
  let text = kept.map((item) => (item.sep != null ? item.sep : item.word)).join('');
  // Tidy: leading punctuation, doubled spaces or commas, space before punctuation.
  text = text
    .replace(/^[\s,;:.!?-]+/, '')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/([,;:])\s*(?=[.!?]|$)/g, '')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) text = '';
  // Sentence case for the first word.
  if (text) text = capitalizeLike(text, 'A');
  return { text, changed: text !== original.trim(), words };
}

module.exports = { rewriteCrossLanguageFillers, EN_REWRITE };
