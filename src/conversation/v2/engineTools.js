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

function hoursReceipt(profile, lang, { day = null, now = new Date() } = {}) {
  const h = hoursFact(profile);
  if (!h) return { tool: 'hours', ok: false, text: null };
  if (!day) {
    const p = L.eatParts(now);
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const row = profile.hoursSchedule?.days?.[keys[p.dow]];
    if (!row || row.closed) {
      return { tool: 'hours', ok: true, text: sw(lang) ? '[PROMPT-PLACEHOLDER] Leo tumefunga.' : '[PROMPT-PLACEHOLDER] We are closed today.' };
    }
    return {
      tool: 'hours',
      ok: true,
      text: sw(lang)
        ? `[PROMPT-PLACEHOLDER] Leo tuko wazi ${row.open}-${row.close}.`
        : `[PROMPT-PLACEHOLDER] Today we are open ${row.open} to ${row.close}.`,
    };
  }
  if (day) {
    const d = new Date(`${day}T12:00:00+03:00`);
    const dow = d.getUTCDay();
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const row = profile.hoursSchedule?.days?.[keys[dow]];
    if (!row || row.closed) return { tool: 'hours', ok: true, text: sw(lang) ? `${L.cap(L.DOW_SW[dow])} tumefunga.` : `We're closed on ${L.cap(L.DOW_EN[dow])}.` };
    return { tool: 'hours', ok: true, text: sw(lang) ? `${L.cap(L.DOW_SW[dow])} tuko wazi ${row.open}-${row.close}.` : `On ${L.cap(L.DOW_EN[dow])} we're open ${row.open} to ${row.close}.` };
  }
  return { tool: 'hours', ok: true, text: h.text };
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
    for (const row of cov.places) {
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
  if (u.answers?.includes('payment')) {
    const pf = OF.paymentFact(OF.ownerFacts(profile));
    if (pf) receipts.push({ tool: 'payment', ok: true, text: sw(lang) ? pf.sw : pf.en });
  }
  return { caller, receipts };
}

module.exports = { runTools, lookupCaller, checkCoverage, priceReceipt, hoursReceipt };
