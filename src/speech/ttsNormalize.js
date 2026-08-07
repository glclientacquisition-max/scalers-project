// Prepare spoken text for clearer Soniox TTS pronunciation on phone calls.

/**
 * Light cleanup so TTS reads more naturally (esp. Kenya phone + mixed EN/SW).
 * Does not invent content — only normalizes punctuation / symbols.
 */
function normalizeForTts(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;

  // Strip markup the model sometimes leaks.
  t = t.replace(/[*_`#]+/g, '');

  // Phone-ish digit runs: read more clearly.
  t = t.replace(/\+(\d[\d\s-]{7,}\d)/g, (_, digits) => {
    const d = String(digits).replace(/\D/g, '');
    return d.split('').join(' ');
  });

  // Common abbreviations.
  t = t
    .replace(/\bwhatsapp\b/gi, 'WhatsApp')
    .replace(/\bm-?pesa\b/gi, 'M-Pesa')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\bOK\b/g, 'okay');

  // Avoid trailing ellipsis that TTS can stretch oddly.
  t = t.replace(/\u2026/g, '.').replace(/\.\.\./g, '.');

  // Keep sentences short-friendly: collapse double punctuation.
  t = t.replace(/([!?.,])\1+/g, '$1');

  return t.trim();
}

/**
 * Pick Soniox TTS language for a spoken line.
 * Prefer Swahili when the line itself is clearly SW-heavy.
 */
function pickTtsLanguage(text, callLanguage) {
  const raw = String(text || '').toLowerCase();
  const swHits = (
    raw.match(
      /\b(habari|sawa|asante|karibu|tafadhali|nina|nataka|ningependa|ndiyo|hapana|kwaheri|jina|msaada|kidogo|naweza|unaweza)\b/g
    ) || []
  ).length;

  if (swHits >= 2 || (callLanguage === 'sw' && swHits >= 1)) return 'sw';
  if (callLanguage === 'sw' && /^[a-z\s,'-]*$/.test(raw) && swHits >= 1) return 'sw';
  return process.env.SONIOX_TTS_LANGUAGE || 'en';
}

module.exports = {
  normalizeForTts,
  pickTtsLanguage,
};
