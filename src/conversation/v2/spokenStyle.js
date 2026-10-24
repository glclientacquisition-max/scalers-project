'use strict';
// BRAIN_V1_DRAFT_PHASE_A: one spoken style for times and prices, applied to every line the brain
// speaks (v1 draft sentences and v2 template lines alike), so history holds what TTS says.
// - English clock times: "14:00" -> "2 PM", "09:30" -> "9:30 AM" (Swahili lines keep v2's own clock).
// - Prices: v2's receipt style ("2,200 shillings per square metre"); "KSh 2,200 per m²" is rewritten to it.
const R = require('./receipts');

function time12(h, m) {
  const H = Number(h); const M = Number(m);
  if (!(H >= 0 && H <= 23 && M >= 0 && M <= 59)) return null;
  const ap = H < 12 ? 'AM' : 'PM'; const h12 = H % 12 === 0 ? 12 : H % 12;
  return M ? `${h12}:${String(M).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}
const PRICE = /\b(from\s+)?(?:KSh\.?|Ksh\.?|KES)\s*([\d,]+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(?:KSh\.?|Ksh\.?|KES)?\s*([\d,]+(?:\.\d+)?))?(\s*(?:per\s+(?:m²|m2|sqm|square metre|room|seat)|\/\s*m²))?/gi;

function spoken(line, lang = 'en') {
  let s = String(line || '');
  if (!s) return s;
  const sw = /^sw/.test(String(lang || ''));
  s = s.replace(PRICE, (all, from, a, b, unit) => {
    const raw = `${from ? 'From ' : ''}KSh ${a}${b ? `-${b}` : ''}${unit ? ` ${String(unit).trim().replace(/^\/\s*/, 'per ')}` : ''}`;
    try { return R.priceTxt(raw, sw) || all; } catch { return all; }
  });
  if (!sw) s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:AM|PM|am|pm))/g, (all, h, m) => time12(h, m) || all);
  return s;
}
module.exports = { spoken, time12 };
