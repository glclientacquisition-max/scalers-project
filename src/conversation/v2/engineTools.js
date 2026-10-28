'use strict';
// Tool receipts for BRAIN_ENGINES (read-only + write hints).
const ML = require('./modelLead');
const AC = require('./areaCoverage');
const RF = require('./replyFacts');
const OF = require('./ownerFacts');
const { hoursFact } = require('./v1draftFacts');
const L = require('./lexicon');

const KBL = require('../../knowledge/kb/live');
const KBR = require('../../knowledge/kb/rules');

function sw(lang) { return L.isSw(lang); }

const ASK_RE = /\?|\b(what|which|do you (have|sell|do|offer)|have you got|any|kinds?|types?|varieties|mna|una|mnauza|mnayo|gani|kuna)\b/i;
const POS_OR_MORE = /\b(first|second|third|1st|2nd|3rd|last one|ya kwanza|ya pili|ya tatu|wa kwanza|wa pili|wa tatu|ya mwisho)\b/i;
/** The v2 KB receipt for this turn, or null when the turn is not about the catalogue. Pure, in memory, < 5 ms. */
function catalogueReceipt({ u, machine, profile, kbh, lang, text, wantsPrice, wantsCoverage }) {
  const asksList = (u.answers || []).includes('services');
  const follow = !!(machine.kb && machine.kb.last) && (KBR.MORE_RE.test(text) || POS_OR_MORE.test(text));
  const slot = u.slots?.service || null;
  // a question that names an item or a group is a catalogue question even when the understanding did not say so
  const named = !wantsPrice && !asksList && !follow && ASK_RE.test(text) && ['ask', 'unknown', 'smalltalk', undefined, null].includes(u.intent) ? (() => { const f = kbh.find(text); return !!(f.named || f.category); })() : false;
  if (!wantsPrice && !asksList && !follow && !slot && !named) return null;
  if (wantsCoverage && !wantsPrice && !asksList && !follow) return null;
  let a = KBR.answer(kbh, text, { asksPrice: wantsPrice, lang, state: machine.kb || {} });
  if (a.kind === 'none' && slot) a = KBR.answer(kbh, slot, { asksPrice: wantsPrice, lang, state: machine.kb || {} });
  if (a.kind === 'none' && wantsPrice && machine.slots?.service) a = KBR.answer(kbh, machine.slots.service, { asksPrice: true, lang, state: machine.kb || {} });
  machine.kb = a.state;
  if (a.text) return { tool: wantsPrice ? 'prices' : 'catalogue', ok: true, kb: true, kind: a.kind, ids: a.ids, text: a.text, ms: Number((a.ms || 0).toFixed(3)), kbVersion: profile.kb.version, ...(a.capture ? { capture: a.capture, service: a.name || null } : {}), ...(a.itemState ? { itemState: a.itemState } : {}) };
  if (asksList) { const o = KBR.overview(kbh, lang); if (o) return { tool: 'catalogue', ok: true, kb: true, kind: 'overview', ids: [], text: o, ms: Number((a.ms || 0).toFixed(3)), kbVersion: profile.kb.version }; }
  if (wantsPrice) return { tool: 'prices', ok: false, kb: true, kind: 'none', ids: [], text: null, ms: Number((a.ms || 0).toFixed(3)), kbVersion: profile.kb.version };
  return null;
}

function lookupCaller(machine, profile, now) {
  return ML.lookupCaller(machine.file || {}, {}, { now, lockedName: require('./callPlan').lockedName(machine) });
}

function checkCoverage(place, profile) {
  const rec = ML.coverageReceipt([place], profile);
  return rec.places[0] || null;
}

function priceReceipt(serviceName, profile, text, lang) {
  const svc = (profile.servicesCatalog || []).find((s) => s.name.toLowerCase() === String(serviceName || '').toLowerCase())
    || require('./callPlan').matchServices(serviceName || text, profile)[0];
  if (!svc) return { tool: 'prices', ok: false, text: null };
  const pl = RF.priceLine(svc, text, lang);
  return { tool: 'prices', ok: true, service: svc.name, text: pl?.text || svc.price_range || null };
}

const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const swPeriod = (hh) => { const h = Number(String(hh).slice(0, 2)); return h < 12 ? 'asubuhi' : h < 16 ? 'mchana' : h < 19 ? 'jioni' : 'usiku'; };
const swT = (hh) => `${L.sayTime(hh, 'sw')} ${swPeriod(hh)}`;
/** Hours receipt: TODAY's hours unless the caller named a day (Alvin: no 32 s weekly list). Clock injected. */
function hoursReceipt(profile, lang, { day = null, now = new Date() } = {}) {
  const h = hoursFact(profile);
  if (!h && !profile.hoursSchedule?.days) return { tool: 'hours', ok: false, text: null };
  const S = sw(lang);
  if (!day) {
    const p = L.eatParts(now);
    const row = profile.hoursSchedule?.days?.[KEYS[p.dow]];
    if (!row) return { tool: 'hours', ok: !!h, text: h ? h.text : null };
    if (row.closed) return { tool: 'hours', ok: true, today: true, closed: true, text: S ? 'Leo tumefunga.' : 'We are closed today.' };
    return { tool: 'hours', ok: true, today: true, open: row.open, close: row.close, text: S ? `Leo tuko wazi kuanzia ${swT(row.open)} hadi ${swT(row.close)}.` : `Today we are open from ${row.open} to ${row.close}.` };
  }
  const d = new Date(`${day}T12:00:00+03:00`);
  const dow = d.getUTCDay();
  const row = profile.hoursSchedule?.days?.[KEYS[dow]];
  if (!row || row.closed) return { tool: 'hours', ok: true, closed: true, text: S ? `${L.cap(L.DOW_SW[dow])} tumefunga.` : `We're closed on ${L.cap(L.DOW_EN[dow])}.` };
  return { tool: 'hours', ok: true, open: row.open, close: row.close, text: S ? `${L.cap(L.DOW_SW[dow])} tuko wazi kuanzia ${swT(row.open)} hadi ${swT(row.close)}.` : `On ${L.cap(L.DOW_EN[dow])} we're open from ${row.open} to ${row.close}.` };
}

function runTools({ understanding, machine, profile, lang, text, now = new Date() }) {
  const receipts = [];
  const u = understanding || {};
  const caller = lookupCaller(machine, profile, now);
  receipts.push({ ...caller, tool: 'lookup_caller' });
  const place = u.slots?.place || machine.slots?.place;
  const wantsCoverage = !!(place || u.answers?.includes('coverage'));
  const wantsPrice = u.answers?.includes('price');
  if (wantsCoverage) {
    const cov = ML.coverageFor(text, profile, { u: { slots: { places: place ? [place] : [] } }, expecting: machine.expecting });
    // a follow-up ("And the fee?") names no place: the call's place is still the subject
    const rows = cov.places.length || !place ? cov.places : ML.coverageReceipt([place], profile).places;
    for (const row of rows) {
      const named = { ...row, name: row.name || row.place || place };
      const line = AC.line(named, lang) || row.line_en || row.line_sw || row.text || null;
      receipts.push({ tool: 'coverage', ...named, text: line });
    }
  }
  const kbh = KBL.handle(profile);
  if (kbh) {
    // v2 KB: one catalogue receipt per turn built by the 12 call rules (<= 3 names, count first, price only on pick)
    const r = catalogueReceipt({ u, machine, profile, kbh, lang, text, wantsPrice, wantsCoverage });
    if (r) receipts.push(r);
    // shadow compare (KB_SHADOW=on): what the old price path would have said, logged next to the KB answer, never spoken
    if (wantsPrice && !wantsCoverage && /^(1|true|on|yes)$/i.test(String(process.env.KB_SHADOW || ''))) {
      try {
        const old = priceReceipt(u.slots?.service || machine.slots?.service, profile, text, lang);
        const nums = (t) => (String(t || '').match(/\d[\d,]*/g) || []).map((x) => x.replace(/,/g, ''));
        const known = KBL.knownNumbers(profile);
        const extra = nums(old.text).filter((n) => !known.has(n));
        console.log(`[kb_shadow] tenant=${profile.id} kb_v=${profile.kb.version} kb_kind=${r ? r.kind : 'none'} old=${old.text ? 'price' : 'none'} agree=${!extra.length} old_only_numbers=${extra.slice(0, 4).join('|') || '-'}`);
      } catch (e) { console.warn(`[kb_shadow] failed: ${e && e.message}`); }
    }
  } else if (wantsPrice && !wantsCoverage) {
    const pr = priceReceipt(u.slots?.service || machine.slots?.service, profile, text, lang);
    if (pr.text) receipts.push(pr);
  }
  if (u.answers?.includes('hours')) {
    receipts.push(hoursReceipt(profile, lang, { day: u.slots?.day || machine.slots?.when?.date, now }));
  }
  if (u.answers?.includes('identity') || u.intent === 'identity') {
    const R = require('./receipts');
    const agent = profile.agentName || null; const biz = profile.businessName || profile.name || null;
    if (agent && biz) receipts.push({ tool: 'identity', ok: true, text: R.info({ kind: 'who', agent, biz }, lang) });
  }
  if (u.answers?.includes('payment')) {
    const pf = OF.paymentFact(OF.ownerFacts(profile));
    if (pf) receipts.push({ tool: 'payment', ok: true, text: sw(lang) ? pf.sw : pf.en });
  }
  return { caller, receipts };
}

module.exports = { runTools, lookupCaller, checkCoverage, priceReceipt, hoursReceipt, catalogueReceipt };
