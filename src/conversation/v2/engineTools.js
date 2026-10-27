'use strict';
// Tool receipts for BRAIN_ENGINES (read-only + write hints).
const ML = require('./modelLead');
const AC = require('./areaCoverage');
const RF = require('./replyFacts');
const OF = require('./ownerFacts');
const { hoursFact } = require('./v1draftFacts');
const L = require('./lexicon');

function sw(lang) { return L.isSw(lang); }

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
  if (wantsPrice && !wantsCoverage) {
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

module.exports = { runTools, lookupCaller, checkCoverage, priceReceipt, hoursReceipt };
