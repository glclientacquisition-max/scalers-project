'use strict';
// Rules-made spoken forms for the v2 KB (go live on a clean compile; no AI, no owner approval needed).
// Trade-neutral: nothing service-specific is added to a product name (fixes "gloria F1 cleaning").
const { numberToSw } = require('../../speech/spokenForms');
const { fmtNum } = require('./items');

// unit -> [english after a price, swahili after a price]
const UNIT_SAY = {
  seedling: ['a seedling', 'kwa mche'], kg: ['a kilo', 'kwa kilo'], tray: ['a tray', 'kwa trei'], seat: ['a seat', 'kwa kiti'],
  hour: ['an hour', 'kwa saa'], sqm: ['per square metre', 'kwa mita mraba'], sqft: ['per square foot', 'kwa futi mraba'],
  room: ['a room', 'kwa chumba'], window: ['a window', 'kwa dirisha'], visit: ['a visit', 'kwa kila ziara'], piece: ['each', 'kila kimoja'],
  litre: ['a litre', 'kwa lita'], bag: ['a bag', 'kwa mfuko'], pack: ['a pack', 'kwa pakiti'], bunch: ['a bunch', 'kwa fungu'], job: null,
};
function unitSay(unit) {
  if (!unit) return null;
  if (Object.prototype.hasOwnProperty.call(UNIT_SAY, unit)) return UNIT_SAY[unit];
  return [`per ${unit}`, `kwa ${unit}`];
}
// en keeps digits (the TTS normaliser reads them); sw is words, the way a Kenyan says it.
function enMoney(n) {
  const whole = Math.floor(Number(n)); const cents = Math.round((Number(n) - whole) * 100);
  if (!cents) return `${fmtNum(whole)} shillings`;
  return whole ? `${fmtNum(whole)} shillings ${cents} cents` : `${cents} cents`;
}
function swMoney(n) {
  const whole = Math.floor(Number(n)); const cents = Math.round((Number(n) - whole) * 100);
  const parts = [];
  if (whole > 0) parts.push(`shilingi ${numberToSw(whole)}`);
  if (cents > 0) parts.push(`senti ${numberToSw(cents)}`);
  return parts.join(' na ') || 'shilingi sifuri';
}
// the low end of a range: bare digits when both ends are whole ("2 to 3 shillings"), else said in full
// ("3 shillings 50 cents to 6 shillings 20 cents"); never "3.50", which a sentence splitter cuts at the dot
const hasCents = (v) => Math.round((Number(v) % 1) * 100) !== 0;
const enLo = (lo, hi) => (hasCents(lo) || hasCents(hi) ? enMoney(lo) : fmtNum(lo));
const swBare = (n) => numberToSw(Math.floor(Number(n))) + (Math.round((Number(n) % 1) * 100) ? ` na senti ${numberToSw(Math.round((Number(n) % 1) * 100))}` : '');

/** Spoken price for one item or variant: { en, sw, numbers[] } or nulls when nothing can be said. */
function sayPrice(p = {}) {
  const u = unitSay(p.unit);
  const tail = (en, sw) => ({ en: u ? `${en} ${u[0]}` : en, sw: u ? `${sw} ${u[1]}` : sw });
  switch (p.price_mode) {
    case 'fixed': case 'per_unit':
      if (p.price_amount == null) break;
      return { ...tail(enMoney(p.price_amount), swMoney(p.price_amount)), numbers: [Number(p.price_amount)] };
    case 'from':
      if (p.price_amount == null) break;
      return { ...tail(`from ${enMoney(p.price_amount)}`, `kuanzia ${swMoney(p.price_amount)}`), numbers: [Number(p.price_amount)] };
    case 'range':
      if (p.price_min == null || p.price_max == null) break;
      return { ...tail(`${enLo(p.price_min, p.price_max)} to ${enMoney(p.price_max)}`, `shilingi ${swBare(p.price_min)} hadi ${swBare(p.price_max)}`), numbers: [Number(p.price_min), Number(p.price_max)] };
    case 'quote':
      return { en: 'a custom quote after the team checks the job', sw: 'bei maalum baada ya timu kukagua kazi', numbers: [], quote: true };
    case 'site_visit':
      return { en: 'priced after a site visit', sw: 'bei baada ya kukagua eneo', numbers: [], quote: true, visit: true };
    case 'free':
      return { en: 'free', sw: 'bure', numbers: [0] };
    default: break;
  }
  return { en: null, sw: null, numbers: [] };
}
/** A group's price span ("from 2 to 6 shillings 20 cents a seedling") over amounts with one shared unit. */
function sayRange(lo, hi, unit) {
  if (lo == null) return { en: null, sw: null, numbers: [] };
  if (hi == null || hi === lo) return sayPrice({ price_mode: 'fixed', price_amount: lo, unit });
  const u = unitSay(unit);
  const en = `from ${enLo(lo, hi)} to ${enMoney(hi)}`; const sw = `kuanzia shilingi ${swBare(lo)} hadi ${swBare(hi)}`;
  return { en: u ? `${en} ${u[0]}` : en, sw: u ? `${sw} ${u[1]}` : sw, numbers: [lo, hi] };
}
/** Spoken English name: owner override, else the name with brackets kept as words ("Admiral F1 yellow"). */
function sayNameEn(it = {}) {
  if (it.spoken_en && String(it.spoken_en).trim()) return String(it.spoken_en).trim();
  return String(it.name_en || '').replace(/[()[\]]/g, ' ').replace(/\s+[-–]\s+/g, ', ').replace(/\s*\/\s*/g, ' or ').replace(/\s+/g, ' ').trim();
}
/** Swahili name is spoken only when the owner approved or edited it (Alvin: AI-suggested, owner-approved). */
function sayNameSw(it = {}) {
  return (it.name_sw_state === 'approved' || it.name_sw_state === 'edited') && it.name_sw ? String(it.name_sw).trim() : null;
}
function joinList(xs, lang) { const w = lang === 'sw' ? 'na' : 'and'; return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${w} ${xs[xs.length - 1]}`; }

module.exports = { sayPrice, sayRange, sayNameEn, sayNameSw, unitSay, enMoney, swMoney, joinList, UNIT_SAY };
