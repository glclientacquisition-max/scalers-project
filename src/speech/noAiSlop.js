// Deterministic cut of model speech immediately before Soniox.
// No LLM. Does not rewrite into new sentences. Exempt paths return the
// input unchanged (visit / hold / order code lines, and any caller that
// passes { exempt: true }).

const SLOP_PHRASES = [
  "it's worth noting",
  "it's important to note",
  'at the end of the day',
  'when it comes to',
  'at its core',
  "in today's world",
  'in the age of',
  'the reality is',
  'the truth is',
  'in terms of',
  'with regard to',
  'in order to',
  'going forward',
  "let's dive in",
  "here's the thing",
  'let me be clear',
  "i'll be honest",
  'paradigm shift',
  'game changer',
  'cutting-edge',
  'ever-evolving',
  'multifaceted',
  'meticulous',
  'intricate',
  'paramount',
  'transformative',
  'supercharge',
  'streamline',
  'facilitate',
  'leverage',
  'utilize',
  'empower',
  'elevate',
  'embark',
  'harness',
  'delve',
  'foster',
  'robust',
  'tapestry',
  'realm',
  'beacon',
];

function normalizeApostrophes(text) {
  return String(text || '').replace(/[’‘]/g, "'");
}

function phraseVariants(phrase) {
  const base = normalizeApostrophes(phrase).toLowerCase();
  const out = new Set([base]);
  if (base.includes('-')) out.add(base.replace(/-/g, ' '));
  if (base.includes(' ')) out.add(base.replace(/\s+/g, '-'));
  return [...out];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseToPattern(phrase) {
  const parts = phrase.split(/\s+/).map((part) => {
    return part
      .split('-')
      .map((bit) => escapeRegExp(bit).replace(/'/g, "['’]"))
      .join('[-\\s]');
  });
  return `\\b${parts.join('\\s+')}\\b`;
}

const PHRASE_RE = new RegExp(
  [...new Set(SLOP_PHRASES.flatMap((phrase) => phraseVariants(phrase)))]
    .sort((a, b) => b.length - a.length)
    .map(phraseToPattern)
    .join('|'),
  'gi'
);

// A sentence that is only one of these is dropped. Single slop words are
// deleted in place; if that empties the whole turn, the original is kept.
const OPENERS = new Set(
  SLOP_PHRASES.filter((phrase) => phrase.includes(' ')).map((phrase) =>
    normalizeApostrophes(phrase).toLowerCase()
  )
);

function speakable(text) {
  return /[A-Za-z0-9]/.test(String(text || ''));
}

function sentenceBody(sentence) {
  return normalizeApostrophes(sentence)
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitSentences(text) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const parts = src.match(/[^.!?]+(?:[.!?]+|$)/g);
  return parts ? parts.map((part) => part.trim()).filter(Boolean) : [src];
}

function stripFencedCode(text) {
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/```[\s\S]*$/g, ' ');
  return t;
}

function stripToolMarkers(text) {
  let t = String(text || '');
  t = t.replace(/###\s*TOOL\s*###[\s\S]*?###\s*ENDTOOL\s*###/gi, ' ');
  t = t.replace(/###\s*(?:ENDCALL|ENDTOOL|TOOL)\s*###/gi, ' ');
  t = t.replace(/###[^#\n]{0,80}###/g, ' ');
  return t;
}

function stripJsonBlocks(text) {
  let t = String(text || '');
  const whole = t.trim();
  if (/^[\[{]/.test(whole)) {
    try {
      const parsed = JSON.parse(whole);
      if (parsed && typeof parsed === 'object') return '';
    } catch {
      /* not a single JSON value */
    }
  }
  t = t.replace(/\{[^{}]*"[^"\n]{0,80}"\s*:[^{}]*\}/g, ' ');
  t = t.replace(/\[[^\[\]\n]*\{[^{}]*\}[^\[\]\n]*\]/g, ' ');
  return t;
}

function stripInstructionLines(text) {
  const lines = String(text || '').split(/\n/);
  const kept = [];
  for (const line of lines) {
    let next = line;
    if (/^(?:system|developer|instruction|instructions)\s*:/i.test(next.trim())) {
      next = next.replace(
        /^(?:system|developer|instruction|instructions)\s*:[^.!?\n]*[.!?]?/i,
        ' '
      );
    }
    if (/^ignore (?:all |any )?(?:previous|prior|above) instructions\b/i.test(next.trim())) {
      next = next.replace(
        /^ignore (?:all |any )?(?:previous|prior|above) instructions\b[^.!?\n]*[.!?]?/i,
        ' '
      );
    }
    if (/^(?:you are|you're) (?:an? )?(?:ai|llm|language model|helpful assistant)\b/i.test(next.trim())) {
      next = '';
    }
    if (speakable(next)) kept.push(next);
  }
  return kept.join(' ');
}

function stripMarkup(text) {
  let t = String(text || '');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*#{1,6}\s+/gm, '');
  // Leftover markdown and symbols TTS would read as "asterisk", "hashtag",
  // "underscore", "bracket", or "quote". Period and question mark stay.
  t = t.replace(/[*_`#>]+/g, '');
  t = t.replace(/[“”"]/g, '');
  t = t.replace(/[\[\]{}]/g, '');
  t = t.replace(/[_/]+/g, ' ');
  t = t.replace(/\u2026/g, '.');
  t = t.replace(/\.{3,}/g, '.');
  return t;
}

function stripLeaks(raw) {
  let t = stripFencedCode(raw);
  t = stripToolMarkers(t);
  t = stripJsonBlocks(t);
  t = stripInstructionLines(t);
  t = stripMarkup(t);
  return t.replace(/\s+/g, ' ').trim();
}

function fixSentence(sentence) {
  const trimmed = String(sentence || '').trim();
  PHRASE_RE.lastIndex = 0;
  let next = trimmed.replace(PHRASE_RE, ' ');
  const cutAPhrase = next !== trimmed;
  next = next.replace(/\s+/g, ' ').trim();
  next = next.replace(/\s+([,.;!?])/g, '$1');
  next = next.replace(/^[\s,;:!?-]+/, '');
  next = next.replace(/\s+/g, ' ').trim();
  if (!speakable(next)) return '';
  if (cutAPhrase && /^[a-z]/.test(next)) next = next[0].toUpperCase() + next.slice(1);
  return next;
}

function applySlop(text) {
  const sentences = splitSentences(text);
  const kept = [];
  for (const sentence of sentences) {
    if (OPENERS.has(sentenceBody(sentence))) continue;
    const cut = fixSentence(sentence);
    if (cut) kept.push(cut);
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Cut AI-slop, markup, and instruction leaks from model speech.
 * @param {string} raw
 * @param {{ exempt?: boolean }} [opts] exempt returns the input unchanged
 * @returns {string}
 */
function cutNoAiSlop(raw, opts = {}) {
  if (opts && opts.exempt) return raw == null ? '' : String(raw);
  const original = String(raw == null ? '' : raw);
  const stripped = stripLeaks(original);
  if (!speakable(stripped)) return '';
  const cut = applySlop(stripped);
  if (!speakable(cut)) return stripped;
  return cut;
}

module.exports = {
  cutNoAiSlop,
};
