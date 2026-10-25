'use strict';
// ONE owed-answer structure for every Brain path (model-lead, template fallback, callCore, call plan):
//   owed answer = { topic, sub, lang, ...ref }   (what was asked, scoped to the sub-question, in the turn language)
// collect() turns the turn's questions (understanding or rules) + the call plan's confirmations into that list;
// render() speaks ONE item from ownerFacts / receipts / catalogue / area picks in item.lang. Nothing else assembles
// answer text, so a cancel question yields only the cancel fact, and every templated answer follows the turn language.
// Niche-agnostic: topics come from the owner's facts and the catalogue, never a trade list.
// Caller-facing wording here is [PROMPT-PLACEHOLDER].
const OF = require('./ownerFacts');
const AC = require('./areaCoverage');
const RF = require('./replyFacts');
const L = require('./lexicon');

const sw = (lang) => L.isSw(lang);
const ML = () => require('./modelLead'); // lazy: modelLead requires this module's peers
const CPm = () => require('./callPlan');

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_EN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DAY_SW = { mon: 'Jumatatu', tue: 'Jumanne', wed: 'Jumatano', thu: 'Alhamisi', fri: 'Ijumaa', sat: 'Jumamosi', sun: 'Jumapili' };
const hhmm = (t) => { const [h, m] = String(t).split(':').map(Number); const ap = h < 12 ? 'AM' : 'PM'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; };
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// spoken clock: EN "7:30 AM"; SW Swahili hours + part of day ("saa moja na nusu asubuhi")
function sayClock(t, lang) {
  if (!sw(lang)) return hhmm(t);
  const h = Number(String(t).split(':')[0]);
  const part = h < 12 ? 'asubuhi' : h < 16 ? 'mchana' : h < 19 ? 'jioni' : 'usiku';
  return `${L.sayTime(t, 'sw')} ${part}`;
}
const DAY_WORDS = [[/\b(monday|mon|jumatatu)\b/i, 'mon'], [/\b(tuesday|tue|jumanne)\b/i, 'tue'], [/\b(wednesday|wed|jumatano)\b/i, 'wed'], [/\b(thursday|thu|alhamisi)\b/i, 'thu'], [/\b(friday|fri|ijumaa)\b/i, 'fri'], [/\b(saturday|sat|jumamosi)\b/i, 'sat'], [/\b(sunday|sun|jumapili)\b/i, 'sun']];
/** The day(s) a hours question names: weekday words, today/leo, tomorrow/kesho, weekend/wikendi (EAT). */
function askedDays(text, now) {
  const t = String(text || ''); const out = [];
  for (const [re, k] of DAY_WORDS) if (re.test(t)) out.push(k);
  if (/\b(weekends?|wikendi)\b/i.test(t)) out.push('sat', 'sun');
  const base = now instanceof Date ? now : new Date();
  const eat = (n) => DOW[new Date(base.getTime() + 3 * 3600e3 + n * 864e5).getUTCDay()];
  if (/\b(today|leo)\b/i.test(t)) out.push(eat(0));
  if (/\b(tomorrow|kesho)\b/i.test(t)) out.push(eat(1));
  return [...new Set(out)];
}
const svcOf = (profile, name) => (profile.servicesCatalog || []).find((x) => x.name === name || x.id === name) || null;
const factOf = (profile, sub) => { const of = OF.ownerFacts(profile); return of.byTopic.get(sub) || of.facts.find((f) => f.id === sub || f.topic === sub) || null; };
const dayOf = (date) => DOW[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Every topic an owed answer can carry, each with an English AND a Swahili rendering. */
const RENDER = {
  coverage(o, c) {
    if (o.row) return (sw(o.lang) ? o.row.line_sw : o.row.line_en) || AC.line(AC.resolve(o.row.place, c.profile), o.lang);
    const r = AC.resolve(c.text || '', c.profile);
    if (r && (r.status !== 'unknown' || r.via === 'unconfirmed')) return AC.line(r, o.lang);
    if (AC.picksPending(c.profile)) return sw(o.lang) ? 'Timu itathibitisha maeneo tunayofika.' : 'The team will confirm the areas we cover.';
    const areas = require('../listedAreas').listedAreaRows(c.profile).map((x) => x.name);
    if (!areas.length) return null;
    return sw(o.lang) ? `Tunafika ${areas.join(', ')}.` : `We cover ${areas.slice(0, -1).join(', ')}${areas.length > 1 ? ', and ' : ''}${areas[areas.length - 1]}.`;
  },
  price(o, c) {
    const pl = RF.priceLine(svcOf(c.profile, o.sub), c.text || '', o.lang); if (pl) return pl.text;
    return sw(o.lang) ? 'Sina bei kamili hapa; timu inaweza kuthibitisha.' : "I don't have the exact price here; the team can confirm.";
  },
  payment(o, c) { return ML().paymentAnswer(c.profile, c.text || '', o.lang); },
  policy(o, c) { const f = factOf(c.profile, o.sub); return f ? OF.spoken(f, o.lang) : null; },
  // [PROMPT-PLACEHOLDER] hours: the day asked about only; otherwise the days grouped in week order, as spoken times
  hours(o, c) {
    const d = (c.profile.hoursSchedule && c.profile.hoursSchedule.days) || {};
    const isOpen = (k) => !!(d[k] && d[k].open && d[k].close);
    if (!WEEK.some(isOpen)) return null;
    const S = sw(o.lang); const span = (k) => `${sayClock(d[k].open, o.lang)} ${S ? 'hadi' : 'to'} ${sayClock(d[k].close, o.lang)}`;
    const days = askedDays(`${o.sub || ''} ${c.text || ''}`, c.now);
    if (days.length) {
      return days.map((k) => (isOpen(k)
        ? (S ? `${DAY_SW[k]} tuko wazi ${span(k)}.` : `On ${DAY_EN[k]} we're open ${span(k)}.`)
        : (S ? `${DAY_SW[k]} tumefunga.` : `We're closed on ${DAY_EN[k]}.`))).join(' ');
    }
    const groups = []; // consecutive days (Mon..Sun) with the same span
    for (const k of WEEK) {
      const key = isOpen(k) ? `${d[k].open}-${d[k].close}` : 'closed'; const g = groups[groups.length - 1];
      if (g && g.key === key) g.days.push(k); else groups.push({ key, days: [k] });
    }
    if (groups.length === 1 && groups[0].key !== 'closed') return S ? `Tuko wazi kila siku, ${span('mon')}.` : `We're open every day, ${span('mon')}.`;
    const name = (k) => (S ? DAY_SW[k] : DAY_EN[k]);
    const range = (g) => (g.days.length === 1 ? name(g.days[0]) : g.days.length === 2 ? `${name(g.days[0])} ${S ? 'na' : 'and'} ${name(g.days[1])}` : `${name(g.days[0])} ${S ? 'hadi' : 'to'} ${name(g.days[g.days.length - 1])}`);
    const open = groups.filter((g) => g.key !== 'closed').map((g) => `${range(g)}, ${span(g.days[0])}`);
    const shut = groups.filter((g) => g.key === 'closed').map(range);
    const tail = shut.length ? (S ? ` ${shut.join(' na ')} tumefunga.` : ` Closed ${shut.join(' and ')}.`) : '';
    return S ? `Tuko wazi ${open.join('; ')}.${tail}` : `We're open ${open.join('; ')}.${tail}`;
  },
  duration(o, c) {
    const dur = RF.durationOf(svcOf(c.profile, o.sub)); if (!dur) return null;
    if (!sw(o.lang)) return `It takes about ${dur}.`;
    const m = dur.match(/^([\d\s\-–to]+?)\s*(hours?|hrs?|minutes?|mins?|days?)$/i); // Swahili puts the unit first: "saa 3-4"
    const unit = m ? (/^h/i.test(m[2]) ? 'saa' : /^m/i.test(m[2]) ? 'dakika' : 'siku') : null;
    return unit ? `Inachukua takriban ${unit} ${m[1].trim().replace(/\s*to\s*/i, '-')}.` : `Inachukua takriban ${dur}.`;
  },
  hours_fit(o, c) {
    const day = ((c.profile.hoursSchedule && c.profile.hoursSchedule.days) || {})[dayOf(o.date)];
    if (!day || !day.open || !day.close || !(o.time >= day.open && o.time < day.close)) return null;
    const k = dayOf(o.date);
    return sw(o.lang) ? `${DAY_SW[k]} tuko wazi ${day.open} hadi ${day.close}, kwa hivyo ${o.time} inafaa.` : `On ${DAY_EN[k]} we're open ${hhmm(day.open)} to ${hhmm(day.close)}, so ${hhmm(o.time)} works.`;
  },
  identity(o, c) { return ML().identityFix({ ...c, lang: o.lang, caller: c.caller || {} }); },
  booking_status(o, c) { const up = (c.caller && c.caller.upcoming) || []; return up.length ? ML().upcomingLine(up, o.lang) : null; },
  // the understanding is missing and the turn could be a cancel request or a policy question: ask, never guess
  clarify(o) {
    if (o.sub === 'cancel') return sw(o.lang) ? 'Unataka kughairi booking yako, au kujua sera yetu ya kughairi?' : 'Do you want to cancel a booking, or hear our cancellation policy?';
    return null;
  },
};
// [PROMPT-PLACEHOLDER] the caller asked the assistant's own name: the persona answers, never "I don't have your name"
RENDER.agent_name = (o, c) => { const n = (c.profile && (c.profile.agentName || c.profile.spokenName)) || null; if (!n) return null; return sw(o.lang) ? `Naitwa ${n}.` : `I'm ${n}.`; };
const AGENT_NAME = /\b(unaitwa|jina lako|wewe ni nani|ni nani (huyu|anaongea)|your name|who (am i|is this|are you)|who'?s (this|speaking)|what should i call you)\b/i;
const CALLER_NAME = /\b(my name|jina langu|naitwa nani|do you (know|have) (me|my)|who am i\b(?! (speaking|talking)))/i;
/** Identity questions split: the assistant's name (agent_name) vs the caller's own name (caller_name). */
function identitySubject(q = {}, text = '') {
  const sub = String(q.subject || '').toLowerCase();
  if (/agent|assistant|your_name|persona/.test(sub)) return 'agent_name';
  if (/caller|my_name|own/.test(sub)) return 'caller_name';
  const t = String(text || '');
  if (CALLER_NAME.test(t)) return 'caller_name';
  if (AGENT_NAME.test(t)) return 'agent_name';
  return 'caller_name';
}
const TOPICS = Object.keys(RENDER);

/** Render one owed answer in its language (null when the store has nothing to say for it). */
function render(o, c = {}) { const f = RENDER[o && o.topic]; return f ? (f(o, { profile: {}, ...c }) || null) : null; }

/**
 * The turn's owed answers. questions: [{type, subject}] from the understanding or the rules; coverage: per-place
 * receipt rows; confirm: the call plan's owed confirmations (CP.owed); policyScan: the rules path also matches the
 * owner's topics in the caller's words. One item per (topic, sub).
 */
function collect({ questions = [], coverage = [], text = '', profile = {}, machine = null, lang = 'en', confirm = [], policyScan = false } = {}) {
  const out = []; const seen = new Set();
  const add = (o) => { const k = `${o.topic}|${o.sub || ''}`; if (seen.has(k)) return; seen.add(k); out.push({ lang, ...o }); };
  const of = OF.ownerFacts(profile);
  const payAsked = questions.some((q) => q.type === 'payment' || q.type === 'pay');
  for (const q of questions) {
    const t = q.type === 'pay' ? 'payment' : q.type;
    if (t === 'coverage') { if (coverage.length) for (const r of coverage) add({ topic: 'coverage', sub: r.place, row: r }); else add({ topic: 'coverage', sub: null }); }
    else if (t === 'price') { const svc = CPm().matchServices(text, profile)[0] || svcOf(profile, machine && machine.slots && machine.slots.service); add({ topic: 'price', sub: svc ? svc.name : null }); }
    else if (t === 'payment') add({ topic: 'payment', sub: null });
    else if (t === 'hours') add({ topic: 'hours', sub: null });
    else if (t === 'identity') add({ topic: identitySubject(q, text) === 'agent_name' ? 'agent_name' : 'identity', sub: null });
    else if (t === 'booking_status') add({ topic: t, sub: null });
    else if (t === 'policy' || t === 'faq' || t === 'other') {
      // scoped: the ONE owner fact the sub-question names (its subject first, the caller's words as backup)
      const f = OF.match(String(q.subject || ''), of)[0] || OF.match(text, of)[0];
      if (f && !(payAsked && (f.family === 'payment' || f.topic === 'deposit'))) add({ topic: 'policy', sub: f.family === 'faq' ? f.id : f.topic });
    } else if (t === 'clarify') add({ topic: 'clarify', sub: q.subject || null });
  }
  if (policyScan) for (const f of OF.match(text, of).slice(0, 2)) { if (payAsked && (f.family === 'payment' || f.topic === 'deposit')) continue; add({ topic: 'policy', sub: f.family === 'faq' ? f.id : f.topic }); }
  for (const o of confirm) add(o);
  return out;
}

/** Whether text already spoken this turn answers the item (the model said it): then it is not owed again. */
function answered(o, said, c = {}) {
  const low = String(said || '').toLowerCase(); if (!low) return false;
  if (o.topic === 'coverage') return o.row ? low.includes(String(o.row.place).toLowerCase()) : /\b(cover|tunafika|hatufiki)\b/.test(low);
  if (o.topic === 'price') return /\b(ksh|kes|shillings?|bei|elfu|thousand|hundred)\b|\d{3,}/i.test(low);
  if (o.topic === 'payment') return /m-?pesa|paybill|cash|bank|crypto|malipo|tunakubali|we take|we accept/i.test(low);
  if (o.topic === 'agent_name') { const n = (c.profile && (c.profile.agentName || c.profile.spokenName)) || ''; return (!!n && low.includes(n.toLowerCase())) || /\b(naitwa|my name is|i'?m called|jina langu ni)\b/.test(low); }
  if (o.topic === 'identity') { const n = CPm().lockedName(c.machine || {}) || (c.caller && c.caller.candidate); return !!n && low.includes(n.toLowerCase()); }
  const line = render(o, c); if (!line) return true;
  const first = String(OF.sentences(line)[0] || line).toLowerCase().slice(0, 24);
  return low.includes(first);
}

module.exports = { identitySubject, askedDays, sayClock, factOf, TOPICS, RENDER, render, collect, answered };
