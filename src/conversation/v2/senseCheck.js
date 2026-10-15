'use strict';
// Plain sense-check for a spoken catalogue line (gate for replay):
// complete natural sentence, caller's language, answers the question, and in
// Swahili no raw catalogue name / English catalogue words.
const EN_WORDS = /\b(cleaning|clean|bedroom|apartment|house|office|package|standard|carpet|mattress|window|deep|commercial|contract|move|post-construction|shillings|which one|would you)\b/i;
const SW_HINT = /\b(tunafanya|ungependa|bei|ni|na|kwa|usafi|ndio|shilingi|kwenye)\b/i;
function senseCheck({ line, lang, intent, sc, caller }) {
  const t = String(line || '').trim(); const problems = [];
  if (caller) {
    const d = require('./lexicon').detectLang(caller);
    const clear = d.sw >= 2 && d.en === 0 ? 'sw' : d.en >= 2 && d.sw === 0 ? 'en' : null;
    if (clear && clear !== lang) problems.push(`caller_${clear}_reply_${lang}`);
  }
  if (!t) problems.push('empty');
  if (!/^[A-Z0-9]/.test(t)) problems.push('not_capitalised');
  if (!/[.?!]$/.test(t)) problems.push('no_end_punctuation');
  if (/\b(and|na|or|au|,)\s*[.?!]$/i.test(t) || /\s[,;]/.test(t)) problems.push('fragment');
  if (/\{\{|\}\}|undefined|null|NaN/.test(t)) problems.push('template_leak');
  if ((t.match(/\?/g) || []).length > 1) problems.push('double_question');
  if (lang === 'sw') {
    if (!SW_HINT.test(t)) problems.push('not_swahili');
    const raw = (sc?.entries || []).map((e) => String(e.raw?.name || '').replace(/\s*\([^)]*\)/g, '').trim()).filter((n) => n.length > 3 && n.split(' ').length > 1);
    if (raw.some((n) => t.toLowerCase().includes(n.toLowerCase()))) problems.push('raw_catalogue_name');
    if (EN_WORDS.test(t)) problems.push('english_word_in_sw');
  } else if (/\b(tunafanya|ungependa|shilingi|usafi|na)\b/i.test(t)) problems.push('swahili_in_en');
  const answers = { list_services: /\b(we do|tunafanya|huduma zetu|all our services)\b/i, list_category: /\b(we do|tunafanya)\b/i, price_service: /\b(shillings|shilingi|quote|bei maalum)\b/i, explain_service: /\b(covers|we do|tunafanya|ni|is)\b/i };
  if (answers[intent] && !answers[intent].test(t)) problems.push('does_not_answer');
  if (t.split(/\s+/).length > 40) problems.push('too_long');
  return { ok: !problems.length, problems };
}
module.exports = { senseCheck };
