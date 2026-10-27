'use strict';
// BRAIN_ENGINES last step before a line leaves the Brain for TTS. Pure, never throws.
// 1) No bracketed tag is ever spoken: "[PROMPT-PLACEHOLDER]", "[TODO]", "<tool>", "{slot}" are stripped
//    and reported (the source is fixed; this is the last-line assertion that catches any regression).
// 2) Spoken forms: ISO dates become day names; English clock times become "2 PM" (Swahili lines already
//    use "saa nane mchana" from the lexicon). One place for every engines line: fixed, model or receipt.
const L = require('./lexicon');

const TAG = /\[[^\]\n]{0,80}\]|<\/?[a-z_][^>\n]{0,60}>|\{\{?[a-z_][^}\n]{0,40}\}?\}/gi;
const ISO_DATE = /\b(20\d\d-\d\d-\d\d)\b/g;
const CLOCK = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm|a\.m\.|p\.m\.))/gi;

function enClock(h, mi) {
  const hh = Number(h); const m = Number(mi);
  const ap = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

function tagsIn(line) {
  return String(line || '').match(TAG) || [];
}

/** -> { text, stripped: string[] }. stripped non-empty means a tag reached the last line (trace + test failure). */
function speakable(line, lang = 'en') {
  const raw = String(line || '');
  const stripped = tagsIn(raw);
  let t = stripped.length ? raw.replace(TAG, ' ') : raw;
  t = t.replace(ISO_DATE, (d) => L.sayDate(d, lang) || d);
  if (!L.isSw(lang)) t = t.replace(CLOCK, (_, h, m) => enClock(h, m));
  t = t.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,.;:]+/, '').trim();
  return { text: t, stripped };
}

module.exports = { speakable, tagsIn, enClock, TAG };
