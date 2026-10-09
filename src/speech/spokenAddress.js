// Spoken form for web addresses and email addresses, before TTS.
//
// Prod HD_d3900cbf2b2d (2026-10-09 20:19 EAT) said the tenant site as
// "arisstationaries. co. ke.": the model wrote "arisstationaries.co.ke.",
// no_ai_slop split it into three sentences, and Soniox read one glued word
// and two full stops. A caller writes it down as "aris stationaries dot co dot
// ke". Kenyan callers say "dot" and "at" in Kiswahili too, so both languages
// use the same words.
//
// Pipeline: strip the scheme and "www.", split glued labels on the tenant's
// own words (business name, spoken name, lexicon spellings), then speak "."
// as "dot", "@" as "at", "/" as "slash", and "-" inside a label as "dash".

const TLD_LABEL = /^(?:co|ke|com|org|net|go|ac|or|ne|info|biz|io|africa|shop|store|online|me|tz|ug|rw|uk|us)$/i;

// host.tld, optionally with path. Needs at least one dot followed by a TLD-ish
// label of 2+ letters, and a host label that is not a number (3.5, 15.000).
const URL_RE =
  /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})((?:\/[a-z0-9._~%-]+)*\/?)(?=$|[\s,;:!?)"'’]|\.(?:\s|$))/gi;
const EMAIL_RE =
  /\b([a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?)@((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})\b/gi;

function addressNormaliseEnabled(env = process.env) {
  const raw = String(env.VOICE_SPOKEN_ADDRESS ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

/**
 * Words the tenant owns, lowercased, 3+ letters, longest first.
 * @param {unknown} terms strings or { match, say } lexicon entries
 */
function normaliseTerms(terms) {
  const out = new Set();
  const add = (value) => {
    for (const w of String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && /[a-z]/.test(w)) out.add(w);
    }
  };
  for (const term of Array.isArray(terms) ? terms : []) {
    if (!term) continue;
    if (typeof term === 'string') add(term);
    else if (typeof term === 'object') {
      // Lexicon match fields can be regex; only take plain words.
      const match = String(term.match || term.from || '');
      if (/^[\p{L}\s'-]+$/u.test(match)) add(match);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Split a glued label on known words: "arisstationaries" with "aris" ->
 * ["aris", "stationaries"]. Unknown remainders stay whole.
 * @param {string} label
 * @param {string[]} terms longest first
 * @returns {string[]}
 */
function segmentLabel(label, terms, depth = 0) {
  const lower = String(label || '').toLowerCase();
  if (!lower || depth > 4 || !terms.length) return lower ? [lower] : [];
  for (const term of terms) {
    if (lower === term) return [lower];
    if (lower.length - term.length < 3) continue;
    if (lower.startsWith(term)) {
      return [term, ...segmentLabel(lower.slice(term.length), terms, depth + 1)];
    }
    if (lower.endsWith(term)) {
      return [...segmentLabel(lower.slice(0, -term.length), terms, depth + 1), term];
    }
  }
  return [lower];
}

function speakLabel(label, terms) {
  return String(label || '')
    .split('-')
    .filter(Boolean)
    .map((part) => segmentLabel(part, terms).join(' '))
    .join(' dash ');
}

function speakHost(host, terms) {
  return String(host || '')
    .split('.')
    .filter(Boolean)
    .map((label) => (TLD_LABEL.test(label) ? label.toLowerCase() : speakLabel(label, terms)))
    .join(' dot ');
}

function speakPath(path, terms) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean);
  if (!parts.length) return '';
  return parts
    .map((p) => ` slash ${speakLabel(p.replace(/[._~%]+/g, '-'), terms)}`)
    .join('');
}

function looksNumeric(host) {
  return /^[\d.]+$/.test(host);
}

/**
 * @param {string} text
 * @param {{ terms?: unknown, enabled?: boolean }} [opts]
 * @returns {string}
 */
function speakAddresses(text, opts = {}) {
  const src = String(text || '');
  const enabled = opts.enabled != null ? opts.enabled : addressNormaliseEnabled();
  if (!enabled || !/[a-z0-9]\.[a-z]|@/i.test(src)) return src;
  const terms = normaliseTerms(opts.terms);
  let out = src.replace(EMAIL_RE, (whole, local, host) => {
    const spokenLocal = String(local)
      .split(/([._-])/)
      .map((piece) =>
        piece === '.' ? ' dot ' : piece === '_' ? ' underscore ' : piece === '-' ? ' dash ' : segmentLabel(piece, terms).join(' ')
      )
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return `${spokenLocal} at ${speakHost(host, terms)}`;
  });
  out = out.replace(URL_RE, (whole, host, path) => {
    if (looksNumeric(host)) return whole;
    // "e.g" / "i.e" are handled elsewhere; skip one-letter host labels.
    const labels = host.split('.');
    if (labels.length < 2 || labels.some((l) => l.length < 2 && !/^\d$/.test(l))) return whole;
    // A plain "word.Word" sentence join without a TLD is not an address.
    if (!TLD_LABEL.test(labels[labels.length - 1]) && !/^(?:https?:\/\/|www\.)/i.test(whole)) {
      return whole;
    }
    return `${speakHost(host, terms)}${speakPath(path, terms)}`;
  });
  return out;
}

module.exports = {
  addressNormaliseEnabled,
  normaliseTerms,
  segmentLabel,
  speakAddresses,
};
