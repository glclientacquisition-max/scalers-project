// Speak policy for any catalogue or other short list.
// Brain decides the items. Voice owns the mouth: one sentence per item,
// conjunction only on the last item, then the closer. Periods are the
// split cues. prepareForTts strips them, so the session must push one
// sentence at a time or the list collapses into a run-on.

const { splitSpeakableChunks } = require('./spokenStreamBuffer');

function swahiliList(lang) {
  const code = String(lang || '').toLowerCase();
  return code === 'sw' || code === 'sheng';
}

function cleanItem(raw) {
  return String(raw || '')
    .replace(/[.!?]+/g, ' ')
    .replace(/^(?:and|na)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asSentence(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

/**
 * Human list rhythm. Each item is its own sentence. `na` / `and` sits only
 * on the last item. `more` is `Na zingine.` / `And more.` The closer, when
 * present, is the last sentence of this line (the name ask is a later line).
 *
 * @param {{
 *   items?: string[],
 *   lang?: string,
 *   more?: boolean,
 *   closer?: string,
 *   lead?: string,
 * }} [opts]
 * @returns {string}
 */
function renderSpokenList(opts = {}) {
  const names = [];
  for (const raw of opts.items || []) {
    const name = cleanItem(raw);
    if (name) names.push(name);
  }
  if (!names.length) return '';

  const sw = swahiliList(opts.lang);
  const conj = sw ? 'Na' : 'And';
  const lead = String(opts.lead || '').replace(/\s+/g, ' ').trim();
  const sentences = [];
  sentences.push(asSentence(lead ? `${lead} ${names[0]}` : names[0]));
  for (const name of names.slice(1, -1)) sentences.push(asSentence(name));
  if (names.length > 1) sentences.push(asSentence(`${conj} ${names[names.length - 1]}`));
  if (opts.more) sentences.push(asSentence(sw ? 'Na zingine' : 'And more'));
  const closer = String(opts.closer || '').replace(/\s+/g, ' ').trim();
  if (closer) sentences.push(asSentence(closer));
  return sentences.filter(Boolean).join(' ');
}

/**
 * One speak-policy decision. Every line is split on sentence marks before
 * punctuation is stripped, so the caller can push them on one Soniox session.
 * @param {string[]} lines
 * @returns {string[]}
 */
function planSpokenSentences(lines) {
  const sentences = [];
  for (const line of lines || []) {
    const { chunks } = splitSpeakableChunks(line, { final: true });
    for (const chunk of chunks) {
      if (chunk) sentences.push(chunk);
    }
  }
  return sentences;
}

module.exports = {
  renderSpokenList,
  planSpokenSentences,
};
