'use strict';
// One reply assembler rule + the code-built facts every Brain answer path shares (DnD sim 2026-10-25):
//   factKeys / createAssembler - dedupe BY FACT at the single place a turn's sentences are emitted (model,
//                                owed answers, template lines and the reducer's own line all pass through it),
//                                so the same fact (a price, a place's coverage, an owner policy sentence)
//                                is never spoken twice in a turn however many producers rendered it.
//   priceLine                  - catalogue price, with quantity x unit price when the service is priced per unit.
//   durationOf                 - the owner's duration for a service (the call plan's owed confirmations use it).
//   placeStatement             - "I'm in X" / "niko X" / "near X": a place mention is owed a coverage answer.
// Niche-agnostic: units, names, durations and areas come from the tenant's catalogue/picks, never a trade list.
// Caller-facing wording here is [PROMPT-PLACEHOLDER].
const OF = require('./ownerFacts');
const AC = require('./areaCoverage');
const L = require('./lexicon');
const { spoken: spokenStyle } = require('./spokenStyle');

const sw = (lang) => L.isSw(lang);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const isQ = (s) => /\?\s*$/.test(String(s || '').trim());
const PRICEY = /\b(ksh|kes|shillings?|bei|elfu|thousand|hundred|mia)\b|\b\d[\d,]{2,}\b/i;
const COVERY = /\b(cover|covers|serve|come to|reach|don'?t|fika|tunafika|hatufiki|near|karibu na|team will confirm|timu itathibitisha|extra|ada)\b/i;
const PAY_METHOD = /\b(m-?pesa|paybill|pay ?bill|till|cash|bank|card|airtel|taslimu)\b/i;

// ---------------------------------------------------------------- quantity x unit price
const SW_NUM = { moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10 };
const EN_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const money = (n) => `KSh ${Math.round(n).toLocaleString('en-US')}`;
/** The quantity the caller gave for a per-unit service ("5-seater", "3 windows", "viti 5", "carpets two"). */
function quantityFor(text, unit) {
  const t = ` ${String(text || '').toLowerCase()} `;
  if (!unit || unit === 'job') return null;
  const u = unit.toLowerCase().replace(/s$/, '');
  const word = `(\\d{1,3}|${Object.keys(EN_NUM).join('|')}|${Object.keys(SW_NUM).join('|')})`;
  const val = (w) => (/^\d+$/.test(w) ? Number(w) : EN_NUM[w] || SW_NUM[w] || null);
  const m = t.match(new RegExp(`\\b${word}[\\s-]*${u}\\w*`)) || t.match(new RegExp(`\\b${u}\\w*\\s+${word}\\b`));
  if (m) return val(m[1]);
  // a lone count with no unit word (e.g. Swahili "viti 5"): only when the turn holds exactly one small number and no clock time
  if (/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|saa\s/.test(t)) return null;
  const all = [...t.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((x) => val(x[1])).filter((n) => n && n < 100);
  return all.length === 1 ? all[0] : null;
}
/** Price line for a catalogue service; per-unit services with a stated quantity get the computed total. */
function priceLine(svc, text, lang) {
  if (!svc || !svc.price_range || svc.pricing?.confirmed === false) return null;
  const p = svc.pricing || {}; const q = quantityFor(text, p.unit);
  const base = sw(lang) ? `${svc.name} ni ${svc.price_range}` : `${svc.name} is ${svc.price_range}`;
  if (q && q > 1 && p.unit && p.unit !== 'job') {
    const lo = Number(p.mode === 'range' ? p.min_ksh : p.amount_ksh); const hi = p.mode === 'range' ? Number(p.max_ksh) : null;
    if (lo > 0) {
      const tot = hi ? `${money(lo * q)} to ${money(hi * q)}` : money(lo * q);
      const totSw = hi ? `${money(lo * q)} hadi ${money(hi * q)}` : money(lo * q);
      return { text: sw(lang) ? `${base}, kwa hivyo ${q} ni ${totSw}.` : `${base}, so ${tot} for ${q} ${p.unit}${q > 1 ? 's' : ''}.`, nums: [lo * q, ...(hi ? [hi * q] : [])].map(String), qty: q };
    }
  }
  return { text: `${base}.`, nums: [], qty: null };
}

// ---------------------------------------------------------------- dedupe by fact
/** The facts one sentence states. Questions and the read-back carry the step, so they key on their text only. */
function factKeys(sentence, { profile = {}, coverage = [], lang = 'en' } = {}) {
  const s = String(sentence || ''); const low = s.toLowerCase(); const keys = new Set();
  if (isQ(s)) return keys;
  if (PRICEY.test(s)) for (const svc of profile.servicesCatalog || []) if (svc.name && low.includes(String(svc.name).toLowerCase())) keys.add(`price:${svc.id || svc.name}`);
  if (COVERY.test(s)) for (const r of coverage) if (r && r.place && new RegExp(`\\b${String(r.place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) keys.add(`place:${r.place.toLowerCase()}`);
  const of = OF.ownerFacts(profile); const pf = OF.paymentFact(of);
  const n = norm(spokenStyle(s, lang));
  const same = (x) => x && norm(spokenStyle(x, lang)) === n;
  if (pf) {
    const all = [...pf.sentences, ...(pf.sentences_sw || [])];
    const i = all.findIndex(same);
    if (i >= 0) keys.add(`owner:payment#${i % pf.sentences.length}`);
    else if (PAY_METHOD.test(s)) keys.add('owner:payment#methods');
    if (i >= 0 && PAY_METHOD.test(all[i])) keys.add('owner:payment#methods');
  }
  for (const f of of.facts) {
    const all = [...(f.sentences || []), ...OF.sentences(f.text_sw || '')];
    const en = (f.sentences || []).length; const i = all.findIndex(same);
    // one key per owner sentence across languages (same sentence count = parallel translation), so EN never repeats SW
    if (i >= 0) keys.add(`owner:${f.topic}#${i < en ? i : (all.length - en === en ? i - en : `sw${i}`)}`);
    // a Swahili call never hears an English owner sentence whose Swahili the owner wrote
    if (i >= 0 && i < en && /^sw/.test(String(lang || '')) && f.text_sw) keys.add('drop:english-owner-line');
  }
  return keys;
}
/**
 * The single reply assembler: admit(text) returns the part of a line not yet said this turn (by fact, then by text),
 * or '' when every sentence is a repeat. Questions are kept unless the exact question was already said.
 */
function createAssembler(ctx = {}) {
  const saidKeys = new Set(); const saidText = new Set();
  const split = (t) => (String(t || '').match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
  function admit(text, { keep = false } = {}) {
    const out = [];
    for (const s of split(text)) {
      const n = norm(spokenStyle(s, ctx.lang));
      if (!n || saidText.has(n)) continue;
      const k = keep ? new Set() : factKeys(s, ctx);
      if (k.has('drop:english-owner-line') || (k.size && [...k].every((x) => saidKeys.has(x)))) continue;
      k.forEach((x) => saidKeys.add(x)); saidText.add(n); out.push(s);
    }
    return out.join(' ');
  }
  return { admit, saidKeys };
}

// ---------------------------------------------------------------- place statements
const PLACE_STATEMENT = /\b(i'?m|i am|we'?re|we are|i live|i stay|i'?m based|located|based|staying)\s+(?:\w+\s+)?(in|at|near|around|by|off)\b|\b(niko|tuko|naishi|nakaa|nipo|tupo)\b|\bkaribu na\b|^\W*(in|near|around)\s+[A-Z]/i;
function placeStatement(text) { return PLACE_STATEMENT.test(String(text || '')); }

// ---------------------------------------------------------------- service duration
/** Duration the owner wrote for the service (a field when present, else the first "about N hours/minutes/days" in its notes). */
function durationOf(svc) {
  if (!svc) return null;
  if (svc.duration) return String(svc.duration);
  if (Number(svc.duration_minutes) > 0) return `${svc.duration_minutes} minutes`;
  const m = String(svc.notes || '').match(/\b(?:about\s+)?(\d+(?:\s*(?:-|–|to)\s*\d+)?\s*(?:hours?|hrs?|minutes?|mins?|days?))\b/i);
  return m ? m[1].replace(/–/g, '-') : null;
}
module.exports = { factKeys, createAssembler, priceLine, quantityFor, placeStatement, durationOf };
