'use strict';
// Deterministic normalisers for BA v2 slots: language, numbers, Swahili clock, dates.
const SW_MARK = /\b(habari|nataka|naomba|kesho|keshokutwa|leo|saa|asubuhi|mchana|jioni|usiku|ndio|ndiyo|hapana|sawa|asante|tafadhali|jina|langu|naitwa|niaje|sasa|mna|mnafungua|mnafanya|kazi|iko|ipo|kubook|kuagiza|niwekee|nitaichukua|nitakuja|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi|usafi|kusafisha|aje|mmeniharibia|sijaridhika|kabisa|mwenye|biashara|ajue|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili|karibu|na|ya|wa|kwa|ni|tu|hiyo|yangu|wangu|gani|wapi|ngapi|lini|nimekam|toner ya|futa|badilisha|nani|wewe|tunaitwaje|unaitwa|shilingi|mnafika|mnakuja|mnahudumia|mnaweza|mtakuja|mko|nilikuwa|kujua|jua|mnaofa\w*|saizi|mnatoa|huduma|unaongea|naongea|mi|mimi|niko|lakini|nitakuja|kidogo|mbali|mnawash\w*|mnasafisha|bei|pesa|uliza|nauliza|unisaidie|msaidia|sijui|hujaniambia|mkuje|hapa|tajiri|wenu|yenu|nipe|ile|hii|hizi|vitu|je|kama|si|ama|hivo|hivyo|wah|eeh|tu|sasa)\b/gi;
const SW_GREET_ONLY = /^\W*(eeh|eh|hi|hello|habari|niaje|sasa|mambo|vipi|hujambo)\W*(habari)?\W*$/i;
const EN_MARK = /\b(the|you|your|i|i'm|is|are|we|will|what|which|can|would|and|for|please|okay|that|have|want|need|book|order|my|me|hello|hi|yes|no|cancel|move|how|much|do|it|in|at|to)\b/gi;

function detectLang(text) {
  const t = String(text || '');
  const sw = (t.match(SW_MARK) || []).length;
  const en = (t.match(EN_MARK) || []).length;
  const words = t.split(/\s+/).filter(Boolean).length;
  const sheng = /\b(niaje|nimekam|ku-book|poa|fiti|maze|sasa)\b/i.test(t);
  return { sw, en, words, greetingOnly: SW_GREET_ONLY.test(t), sheng };
}
// Sticky call language: set by the first content turn; switches only on a clear signal.
function nextLanguage(prev, text) {
  const d = detectLang(text);
  if (d.greetingOnly) return prev || null;
  const vote = d.sw > d.en ? 'sw' : d.en > d.sw ? 'en' : null;
  const tag = (v) => (v === 'sw' && d.sheng ? 'sheng' : v);
  if (!prev) return vote && d.words >= 2 && (Math.max(d.sw, d.en) >= 2 || Math.min(d.sw, d.en) === 0) ? tag(vote) : null;
  const base = prev === 'en' ? 'en' : 'sw';
  // follow the caller's latest clear content turn; short/ambiguous turns keep the call language
  const win = vote === 'sw' ? d.sw : d.en; const lose = vote === 'sw' ? d.en : d.sw;
  if (vote && vote !== base && d.words >= 2 && win >= 2 && win >= lose + 2) return tag(vote);
  return prev;
}
const isSw = (lang) => /^(sw|sheng|mixed)/.test(String(lang || ''));

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1,
  moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10 };
const SW_HOUR_WORDS = 'moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi na moja|kumi na mbili|kumi';
function toNum(w) {
  const s = String(w || '').toLowerCase().trim();
  const tens = s.match(/^(kumi|ishirini|thelathini)(?: na (moja|mbili|tatu|nne|tano|sita|saba|nane|tisa))?$/);
  if (tens && s !== 'kumi') return { kumi: 10, ishirini: 20, thelathini: 30 }[tens[1]] + (tens[2] ? NUM[tens[2]] : 0);
  if (/^\d+$/.test(s)) return Number(s);
  if (s === 'kumi na moja') return 11;
  if (s === 'kumi na mbili') return 12;
  return NUM[s] ?? null;
}

// Swahili clock: saa N counts from 06:00/18:00. saa 4 = 10:00, saa nane mchana = 14:00.
function swClock(n, period) {
  let h = (n % 12) + 6;
  if (/usiku/.test(period || '') && h < 18) h += 12;
  if (/jioni/.test(period || '') && h < 15) h += 12;
  if (/alfajiri/.test(period || '') && h > 12) h -= 12;
  return h % 24;
}
const pad = (n) => String(n).padStart(2, '0');

const CORR = /\b(?:no|sorry|actually|i mean|i meant|hapana|samahani|badala yake|nimekosea|sema|nilimaanisha|la(?=,))\b[,\s]+/gi;
function parseTime(text) {
  const raw = String(text || '');
  const parts = raw.split(CORR);
  if (parts.length > 1) { const tail = parseTime1(parts[parts.length - 1]); if (tail) return tail; }
  return parseTime1(raw);
}
function parseTime1(text) {
  const t0 = ` ${String(text || '').toLowerCase()} `;
  // "half past ten" / "quarter past nine" / "noon" / "midday"
  const t = t0.replace(/\b(?:at\s+)?(noon|midday|mid-day)\b/, ' at 12:00 ').replace(/\b(half|quarter) past (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/, (m, q, n) => { let h = toNum(n); if (h == null) return m; if (h >= 1 && h <= 6) h += 12; return ` ${h}:${q === 'half' ? '30' : '15'} `; });
  let m = t.match(new RegExp(`\\bsaa\\s+(\\d{1,2}|${SW_HOUR_WORDS})(?:[:.](\\d{2}))?(?:\\s+(?:na\\s+)?(nusu|robo))?(?:\\s+(asubuhi|mchana|jioni|usiku|alfajiri))?`));
  if (m) {
    const n = toNum(m[1]); if (n == null || n < 1 || n > 12) return null;
    let min = m[2] ? Number(m[2]) : m[3] === 'nusu' ? 30 : m[3] === 'robo' ? 15 : 0;
    return { hhmm: `${pad(swClock(n, m[4]))}:${pad(min)}`, raw: m[0].trim() };
  }
  m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W)/);
  if (m) {
    let h = Number(m[1]) % 12; if (/p/.test(m[3])) h += 12;
    return { hhmm: `${pad(h)}:${pad(m[2] ? Number(m[2]) : 0)}`, raw: m[0].trim() };
  }
  m = t.match(/\b(?:at|around|by)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[:.](\d{2}))?(?:\s*(?:o'?clock))?(?:\s+in the\s+(morning|afternoon|evening))?\b/);
  if (!m) m = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*o'?clock)?\s+in the\s+(morning|afternoon|evening)\b/) && [null, ...t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*o'?clock)?\s+in the\s+(morning|afternoon|evening)\b/).slice(1, 2), undefined, t.match(/in the\s+(morning|afternoon|evening)/)[1]];
  if (m) {
    let h = toNum(m[1]); if (h == null || h > 23) return null;
    const per = m[3];
    if (per === 'afternoon' || per === 'evening') { if (h < 12) h += 12; } else if (!per && h >= 1 && h <= 6) h += 12; // "at 2" in business hours = 14:00
    return { hhmm: `${pad(h)}:${pad(m[2] ? Number(m[2]) : 0)}`, raw: String(m[0] || '').trim() };
  }
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return { hhmm: `${pad(Number(m[1]))}:${m[2]}`, raw: m[0] };
  return null;
}

const DOW_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DOW_SW = ['jumapili', 'jumatatu', 'jumanne', 'jumatano', 'alhamisi', 'ijumaa', 'jumamosi'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
const EAT_MS = 3 * 3600e3;
const eatParts = (d) => { const e = new Date(d.getTime() + EAT_MS); return { y: e.getUTCFullYear(), mo: e.getUTCMonth(), d: e.getUTCDate(), dow: e.getUTCDay(), h: e.getUTCHours(), mi: e.getUTCMinutes() }; };
const isoDate = (p) => `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}`;
function addDays(now, n) { const p = eatParts(now); const x = new Date(Date.UTC(p.y, p.mo, p.d + n)); return { y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay() }; }

function parseDate(text, now) {
  const t = String(text || '').toLowerCase();
  let m;
  if (/\b(keshokutwa|day after (tomorrow|tommorow|tomorow|tmrw))\b/.test(t)) return { date: isoDate(addDays(now, 2)), raw: 'keshokutwa' };
  // HD_cc0481620c50: 00:00-04:59 EAT "kesho"/"tomorrow" may mean later today (the caller hasn't slept yet)
  if (/\b(kesho+|tomorrow|tommorow|tomorow|tmrw|tmoro)\b/.test(t)) return { date: isoDate(addDays(now, 1)), raw: 'tomorrow', ...(eatParts(now).h < 6 ? { smallHours: { today: isoDate(addDays(now, 0)), tomorrow: isoDate(addDays(now, 1)), todayDow: eatParts(now).dow, tomorrowDow: addDays(now, 1).dow } } : {}) };
  if (/\b(tonight|leo usiku)\b/.test(t)) return { date: isoDate(addDays(now, 0)), raw: 'tonight', tonight: true };
  if (/\b(leo|today|this (morning|afternoon|evening))\b/.test(t)) return { date: isoDate(addDays(now, 0)), raw: 'today' };
  const today = eatParts(now).dow;
  // self-corrections ("Friday, no, Saturday"): the weekday mentioned last wins
  let best = null;
  for (const [list] of [[DOW_EN], [DOW_SW]]) {
    for (let i = 0; i < 7; i++) {
      const re = new RegExp(`\\b${list[i]}\\b`, 'g'); let mm;
      while ((mm = re.exec(t))) if (!best || mm.index > best.at) best = { i, at: mm.index, w: list[i] };
    }
  }
  // a bare day of the month: "the 16th", "tarehe 16", "tarehe kumi na sita" (this month, else next)
  const dm = t.match(/\b(?:the|on the|tarehe)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/) || t.match(/\btarehe\s+((?:kumi|ishirini|thelathini)(?: na (?:moja|mbili|tatu|nne|tano|sita|saba|nane|tisa))?)\b/);
  let byNum = null;
  if (dm) { const d = toNum(dm[1]); const p = eatParts(now); if (d >= 1 && d <= 31) { let x = new Date(Date.UTC(p.y, p.mo, d)); if (d < p.d) x = new Date(Date.UTC(p.y, p.mo + 1, d)); byNum = { y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay() }; } }
  if (best) {
    let n = (best.i - today + 7) % 7;
    const isNext = new RegExp(`\\bnext\\s+${best.w}\\b|\\b${best.w}\\s+ijayo\\b`).test(t);
    if (isNext && n === 0) n = 7;
    const wd = addDays(now, n);
    // "next Friday" while this week's Friday is still ahead: ask which, naming both dates
    if (isNext && n > 0 && n < 7 && !byNum) { const nx = addDays(now, n + 7); return { date: null, raw: best.w, conflict: { kind: 'next', a: isoDate(wd), aDow: wd.dow, b: isoDate(nx), bDow: nx.dow } }; }
    // weekday and date disagree ("Friday the 17th" when Friday is the 16th): ask, never pick silently
    if (byNum && isoDate(byNum) !== isoDate(wd)) return { date: null, raw: best.w, conflict: { a: isoDate(wd), aDow: wd.dow, b: isoDate(byNum), bDow: byNum.dow } };
    return { date: isoDate(wd), raw: best.w };
  }
  if (byNum) return { date: isoDate(byNum), raw: dm[0] };
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/);
  if (m) { const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2]); const p = eatParts(now); return { date: `${p.y}-${pad(mo + 1)}-${pad(Number(m[1]))}`, raw: m[0] }; }
  return null;
}
function parseWhen(text, now) {
  const d = parseDate(text, now); const tm = parseTime(text);
  if (!d && !tm && !/\b(right now|like now|immediately|asap|sasa hivi|mara moja|saa hii hii)\b/i.test(String(text || ''))) return null;
  // "right now" / "sasa hivi": today, at the next half hour
  if (!tm && /\b(right now|like now|immediately|asap|sasa hivi|mara moja|saa hii hii)\b/i.test(String(text || ''))) { const p = eatParts(now); const mins = Math.ceil((p.h * 60 + p.mi + 1) / 30) * 30; return { date: isoDate(addDays(now, 0)), time: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`, raw: 'now', asap: true }; }
  return { date: d ? d.date : null, time: tm ? tm.hhmm : (d && d.tonight ? '20:00' : null), raw: [d && d.raw, tm && tm.raw].filter(Boolean).join(' '), ...(d && d.smallHours ? { smallHours: d.smallHours } : {}), ...(d && d.conflict ? { conflict: d.conflict } : {}) };
}
function whenToIso(when) { if (!when?.date || !when?.time) return null; return new Date(`${when.date}T${when.time}:00+03:00`).toISOString(); }
function dateParts(iso) { const [y, mo, d] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, mo - 1, d)); return { y, mo: mo - 1, d, dow: x.getUTCDay() }; }
function sayDate(date, lang) {
  if (!date) return '';
  const p = dateParts(date);
  return isSw(lang) ? `${cap(DOW_SW[p.dow])} ${p.d} ${MONTH_SW[p.mo]}` : `${cap(DOW_EN[p.dow])} ${p.d} ${MONTH_EN[p.mo]}`;
}
const SW_COUNT = ['kumi na mbili', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa', 'kumi', 'kumi na moja'];
function sayTime(hhmm, lang) {
  if (!hhmm) return '';
  const [h, mi] = hhmm.split(':').map(Number);
  if (isSw(lang)) { const n = (h + 6) % 12; return `saa ${SW_COUNT[n]}${mi === 30 ? ' na nusu' : mi ? ` na dakika ${mi}` : ''}`; }
  return hhmm;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
module.exports = { detectLang, nextLanguage, isSw, parseTime, parseDate, parseWhen, whenToIso, sayDate, sayTime, toNum, eatParts, isoDate, DOW_EN, DOW_SW, cap };
