// The single sanitiser between text and the Soniox TTS wire on the
// structured path (VOICE_STRUCTURED_OUTPUT=on). Every piece the call speaks
// goes through here: model say[] sentences, data lines, repair lines, tool
// confirmations and canned lines. Upstream code checks facts and language and
// never rewrites wording.
//
// Steps: strip markup, choose the TTS language (the locked reply language
// wins), Sheng respelling, tenant lexicon (built-in syllable respellings only
// with VOICE_STRUCTURED_RESPELL=on), money/time/phone spoken forms, spoken
// punctuation, refuse a letterless piece, and open every later piece of a
// stream with a word gap. The legacy stream-join repairs ("Ican" -> "I can")
// are not here: pieces are whole sentences, so nothing arrives glued.

const { stripMarkup, resolveTtsLanguage, stripSpokenPunctuation, mergeExtraLexicon } = require('../ttsNormalize');
const { applyLexicon } = require('../pronunciationLexicon');
const { expandPhones, expandSpokenForms } = require('../spokenForms');
const { shouldRewriteSheng, rewriteShengForTts } = require('../shengRewrite');
const { prosodyMarksEnabled, builtinRespellEnabled } = require('./flag');
const { getLanguagePack } = require('./languages');

const SPOKEN_CHAR = /[\p{L}\p{N}]/u;
const WORD = String.raw`(?!(?:and|na)\b)\p{L}[\p{L}'’-]*`;
const FIRST_ITEM = String.raw`${WORD}(?:\s+${WORD}){0,2}`;
const ITEM = String.raw`${WORD}(?:\s+${WORD}){0,1}`;
const SERIAL_LIST = new RegExp(
  String.raw`(?<![\p{L}'’-])${FIRST_ITEM}(?:,\s+${ITEM})+,?\s+(and|na)\s+${ITEM}(?![\p{L}'’-])`,
  'giu'
);

/**
 * "sofa, carpet and mattress" -> "sofa and carpet and mattress", so the list
 * keeps a beat once commas are stripped. A clause comma ("cleaning, we
 * offer") is not a list join: middle items are one or two words.
 */
function speakListJoins(text) {
  return String(text || '').replace(SERIAL_LIST, (match, conj, offset, whole) => {
    // "Je, naongea na Alvin?" / "Sawa, ..." : one word then a comma at the
    // start of a sentence is an interjection or a vocative, not a list item.
    const head = match.slice(0, match.indexOf(','));
    const atStart = /(?:^|[.!?]\s+)$/.test(whole.slice(0, offset));
    if (atStart && !/\s/.test(head.trim())) return match;
    return match
      .replace(/,?\s+(?:and|na)\s+(?=\S+(?:\s+\S+)?$)/i, ', ')
      .split(/\s*,\s+/)
      .join(` ${conj.toLowerCase()} `);
  });
}

/** Marks Soniox would read aloud become spoken forms or pauses. */
function spokenMarks(text, { keepMarks }) {
  let t = String(text || '');
  t = t.replace(/\be\.g\./gi, 'for example').replace(/\bi\.e\./gi, 'that is');
  t = t.replace(/\band\/or\b/gi, 'and or').replace(/&/g, ' and ');
  t = t.replace(/\u2026|\.{2,}/g, '.');
  t = t.replace(/\s*[\u2014\u2013]\s*|\s+-\s+/g, ', ');
  t = t.replace(/\s*\(([^()]*)\)\s*/g, ', $1, ');
  t = t.replace(/[“”«»"]/g, '');
  t = t.replace(/!+/g, '.');
  t = t.replace(/\s+([,.?;:])/g, '$1').replace(/([,.?])\1+/g, '$1');
  t = t.replace(/^[,.;:\s]+/, '');
  if (keepMarks) {
    // Only the three marks that carry prosody survive.
    t = t.replace(/[;:]/g, ',');
    return t.replace(/\s+/g, ' ').trim();
  }
  return stripSpokenPunctuation(speakListJoins(t));
}

/**
 * @param {string} text
 * @param {{ callLanguage?: string, language?: string, extraLexicon?: unknown, first?: boolean, env?: object }} [opts]
 *   language: the locked reply language for this piece (en | sw | sheng)
 * @returns {{ original: string, text: string, wire: string, language: 'en'|'sw', refused?: string }}
 */
function prepareStructuredPiece(text, opts = {}) {
  const env = opts.env || process.env;
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  const lockedPack = opts.language ? getLanguagePack(opts.language) : null;
  const forced = lockedPack ? lockedPack.tts : undefined;
  let spoken = stripMarkup(original);
  const language = resolveTtsLanguage(spoken, opts.callLanguage, forced);
  const sheng = lockedPack ? lockedPack.code === 'sheng' : shouldRewriteSheng(spoken, opts.callLanguage);
  if (sheng) spoken = rewriteShengForTts(spoken);
  spoken = applyLexicon(spoken, language, mergeExtraLexicon(opts.extraLexicon), {
    builtinRespell: builtinRespellEnabled(env),
  });
  spoken = expandSpokenForms(spoken, language);
  spoken = expandPhones(spoken);
  spoken = spokenMarks(spoken, { keepMarks: prosodyMarksEnabled(env) }).replace(/\s+/g, ' ').trim();
  if (!spoken || !SPOKEN_CHAR.test(spoken)) {
    return { original, text: '', wire: '', language, refused: original ? 'letterless' : 'empty' };
  }
  const wire = opts.first === false ? ` ${spoken}` : spoken;
  return { original, text: spoken, wire, language };
}

module.exports = { prepareStructuredPiece, speakListJoins, spokenMarks };
