'use strict';
// Words the model ran together ("KeshoTukowazisaa", "Ungetakalinisetup").
// HD_17429802746e (19 Oct): the glue was inside one Gemini delta, so the
// stream joiner (streamJoinTrace) could only count it. This repairs it before
// the speech guard and the sentence lint read the line:
//   1. A lower→Upper boundary inside a word is a missing space (brand names
//      such as WhatsApp are kept).
//   2. Swahili only: an unknown word of 9+ letters that splits fully into
//      known words is split ("tukowazisaa" → "tuko wazi saa").
//   3. Swahili only: an unknown word of 12+ letters that does not split, or a
//      case-split piece that is still unknown and long, drops the sentence.
// English words are never split by the word list and never dropped.

const LIST = require('./data/spokenWords.json');

const WORDS = new Set(LIST.words);
const TWO = new Set(LIST.twoLetter);
const BRANDS = new Set(['whatsapp', 'tiktok', 'youtube', 'linkedin', 'paypal', 'iphone', 'ipad', 'mpesa', 'facebook', 'instagram', 'macbook', 'playstation']);
const SPLIT_MIN = 9;
// subject + tense (+ object) + root: "tunakusaidia", "ungetaka", "nitakupigia".
// A verb-shaped word is split only into long pieces and is never dropped.
const VERB_SHAPE = /^(?:ni|u|a|tu|m|mu|wa|ha|hu|si|ki|vi|zi|li|ya|i)(?:na|ta|li|me|nge|ngali|ka|ki|sha)(?:ni|ku|mu|m|mw|tu|wa|ki|vi|zi|li|ya|ji)?[a-z]{3,}$/;
const DAY_NAMES = new Set(['jumatatu', 'jumanne', 'jumatano', 'alhamisi', 'ijumaa', 'jumamosi', 'jumapili', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const DROP_MIN = 12;

function swish(language) {
  const l = String(language || '').toLowerCase();
  return l === 'sw' || l === 'sheng' || l.startsWith('swahili');
}

function knownSet(extraWords) {
  if (!extraWords || !extraWords.size) return WORDS;
  return { has: (w) => WORDS.has(w) || extraWords.has(w) };
}

/** Words the business itself uses: catalogue names, business and agent name, areas. */
function profileWords(profile = {}) {
  const out = new Set();
  const add = (text) => {
    for (const w of String(text || '').toLowerCase().match(/[a-z]+/g) || []) if (w.length >= 3) out.add(w);
  };
  for (const row of [...(profile.servicesCatalog || []), ...(profile.productCatalog || [])]) add(row?.name);
  add(profile.businessName);
  add(profile.agentName);
  add(profile.spokenName);
  return out;
}

/** Fewest pieces, every piece a known word (2-letter pieces from the short list only). */
function segment(word, known) {
  const n = word.length;
  const best = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < n; i += 1) {
    if (!best[i]) continue;
    for (let j = i + 2; j <= Math.min(n, i + 24); j += 1) {
      const piece = word.slice(i, j);
      const ok = piece.length === 2 ? TWO.has(piece) : known.has(piece);
      if (!ok) continue;
      const next = [...best[i], piece];
      if (!best[j] || next.length < best[j].length) best[j] = next;
    }
  }
  return best[n] && best[n].length >= 2 ? best[n] : null;
}

function matchCase(original, pieces) {
  if (/^[A-Z]/.test(original)) pieces[0] = pieces[0].charAt(0).toUpperCase() + pieces[0].slice(1);
  return pieces.join(' ');
}

/**
 * @param {string} sentence
 * @param {{ language?: string, extraWords?: Set<string> }} [opts]
 * @returns {{ text: string, changed: boolean, drop: boolean }}
 */
function repairSentence(sentence, opts = {}) {
  const raw = String(sentence || '');
  const sw = swish(opts.language);
  const known = knownSet(opts.extraWords);
  let drop = false;
  // Leave {fact.refs} alone.
  const parts = raw.split(/(\{[^}]*\})/);
  const fixed = parts.map((part) => {
    if (/^\{[^}]*\}$/.test(part)) return part;
    return part.replace(/[A-Za-z]+/g, (token) => {
      const lower = token.toLowerCase();
      let pieces = [token];
      let caseSplit = false;
      if (/[a-z][A-Z]/.test(token) && !BRANDS.has(lower)) {
        pieces = token
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .split(' ')
          .map((piece, i) => {
            const low = piece.toLowerCase();
            // A glued sentence start is not a proper noun: "Kesho Tuko" → "Kesho tuko".
            return i > 0 && known.has(low) && !DAY_NAMES.has(low) ? low : piece;
          });
        caseSplit = true;
      }
      const out = pieces.map((piece, index) => {
        const low = piece.toLowerCase();
        const inner = caseSplit && index > 0 && !DAY_NAMES.has(low);
        if (!sw || piece.length < SPLIT_MIN || known.has(low)) return piece;
        const verb = low.length <= 16 && VERB_SHAPE.test(low);
        const split = segment(low, known);
        if (split && (!verb || (split[0].length >= 6 && split.every((w) => w.length >= 4)))) {
          return matchCase(inner ? low : piece, split);
        }
        if (verb) return piece;
        if (piece.length >= DROP_MIN || (caseSplit && piece.length >= SPLIT_MIN)) drop = true;
        return piece;
      });
      return out.join(' ');
    });
  });
  let text = fixed.join('');
  // A split can meet a word the model also wrote: "tukowazisaa saa mbili" → "saa saa".
  if (text !== raw) text = text.replace(/\b([A-Za-z]+) \1\b/gi, '$1');
  return { text, changed: text !== raw, drop };
}

/**
 * Whole line, sentence by sentence. A sentence that cannot be repaired is dropped.
 * @returns {{ text: string, split: boolean, dropped: string[] }}
 */
function repairGluedWords(text, opts = {}) {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = [];
  const dropped = [];
  let split = false;
  for (const sentence of sentences) {
    const r = repairSentence(sentence, opts);
    if (r.drop) {
      dropped.push(sentence);
      continue;
    }
    if (r.changed) split = true;
    kept.push(r.text);
  }
  return { text: kept.join(' ').trim(), split, dropped };
}

module.exports = { repairGluedWords, repairSentence, profileWords, segment };
