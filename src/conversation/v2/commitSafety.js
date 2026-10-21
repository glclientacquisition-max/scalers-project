'use strict';
// BRAIN_V2_COMMIT_SAFETY (default off): plan row C1 (briefs/v2-greeting-and-path-plan.md).
// Anything that commits the business (booking, order, quote, visit, callback) is a
// two-phase write: propose_* mints a server-side confirm token bound to a hash of the
// normalized slots; confirm redeems it only on the caller's NEXT turn, on an explicit
// whole-answer yes (or a repeat of the read-back time, Alvin's rule) with no slot diff.
// Validators (hours, service area, availability) run before propose. One idempotency
// key (call + tool + slot hash) goes to the row and to the write receipt. A failed
// write becomes an outbox owner task and the caller hears an honest line.
// Off: nothing here is called; the machine keeps its Phase 1 behaviour.
const crypto = require('crypto');

const ON = /^(1|true|on|yes)$/i;
function commitSafetyEnabled(env = null) { return ON.test(String((env ? env.BRAIN_V2_COMMIT_SAFETY : process.env.BRAIN_V2_COMMIT_SAFETY) || '')); }

const low = (v) => String(v == null ? '' : v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9:]+/g, ' ').trim();
const digits = (v) => String(v || '').replace(/\D/g, '');

// Normalized slots per tool: what the caller is agreeing to, nothing else.
function normSlots(p = {}) {
  switch (p.tool) {
    case 'create_booking': return { service: low(p.service), date: p.when?.date || null, time: p.when?.time || null, place: low(p.place), landmark: low(p.landmark) || null };
    case 'create_order': return { items: (p.items || []).map((x) => ({ id: x.product_id || low(x.name), qty: Number(x.qty) || null })).sort((a, b) => String(a.id).localeCompare(String(b.id))), pickup: p.pickup?.date || null };
    case 'update_booking': return { row: p.row?.id || null, date: p.when?.date || null, time: p.when?.time || null };
    case 'cancel_booking': return { row: p.row?.id || null };
    case 'create_handoff': return { kind: p.kind || 'callback', phone: digits(p.phone) || null, when: p.callbackWhen?.key || null, place: low(p.place) || null, topic: low(p.topic) || null };
    default: return { tool: p.tool || null };
  }
}
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {});
  return v;
}
function slotHash(p) { return crypto.createHash('sha256').update(JSON.stringify(stable({ tool: p.tool, ...normSlots(p) }))).digest('hex').slice(0, 16); }

// #845 brain_write_receipts.tool vocabulary.
function receiptTool(p = {}) {
  if (p.tool === 'create_booking' || p.tool === 'update_booking' || p.tool === 'cancel_booking') return 'book_appointment';
  if (p.tool === 'create_order') return 'create_order';
  if (p.tool === 'log_complaint') return 'log_complaint';
  if (p.tool === 'create_handoff') return p.kind === 'quote' ? 'quote' : (p.kind === 'address' || p.kind === 'payment') ? 'escalate' : 'request_callback';
  return 'escalate';
}
function idempotencyKey({ callId, p }) { return `${String(callId || 'nocall')}:${p.tool}:${slotHash(p)}`; }

// Explicit whole-answer yes. "okay wait", "but ...", questions and anything that adds
// content are not a yes. Words allowed around the yes are confirmations only.
const YES_WORD = /\b(yes|yeah|yep|yup|ok|okay|sure|correct|right|exactly|absolutely|definitely|perfect|fine|confirm(ed)?|ndio|ndiyo|eeh|sawa|poa|fiti|kabisa|haya|sahihi|bila shaka|weka|endelea|thibitisha)\b/i;
const NOT_YES = /\?|\b(but|lakini|ila|wait|ngoja|subiri|hold on|let me|nikuulize|first|kwanza|check|nitaangalia|nitaangalia|maybe|labda|i think|sijui|not sure|hmm+|actually|instead|change|badilisha|badala|no|not|hapana|si|sio|siyo|don'?t|usi\w*|later|baadaye|ni hayo tu|that'?s all|bye|kwaheri)\b/i;
const FILLER = new Set(['uh', 'um', 'ah', 'oh', 'eh', 'mm', 'please', 'go', 'ahead', 'do', 'it', 'that', 'thats', "that's", 'is', 'its', "it's", 'all', 'good', 'great', 'book', 'place', 'the', 'order', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'correct', 'right', 'exactly', 'absolutely', 'definitely', 'perfect', 'fine', 'confirm', 'confirmed', 'thank', 'you', 'thanks', 'ndio', 'ndiyo', 'eeh', 'sawa', 'poa', 'fiti', 'kabisa', 'haya', 'sahihi', 'bila', 'shaka', 'weka', 'endelea', 'thibitisha', 'iko', 'asante', 'sana', 'ni', 'vizuri', 'alright', 'sounds', 'so', 'just', 'very', 'much', 'nithibitishie', 'naam', 'hiyo', 'hio']);
function explicitYes(text) {
  const t = String(text || '').trim();
  if (!t || !YES_WORD.test(t) || NOT_YES.test(t)) return false;
  const words = t.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
  return words.length <= 8 && words.every((w) => FILLER.has(w));
}

// Callback time stated in the read-back so the owner (A4) knows when they promised to call.
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function callbackWhen({ profile = {}, now = new Date(), when = null, L }) {
  const sw = (lang) => L.isSw(lang);
  const per = (hh) => { const h = Number(String(hh).slice(0, 2)); return h < 12 ? 'asubuhi' : h < 16 ? 'mchana' : h < 19 ? 'jioni' : 'usiku'; };
  const swT = (hh, lang) => `${L.sayTime(hh, lang)} ${per(hh)}`;
  if (when?.date || when?.time) {
    return { key: `${when.date || ''}T${when.time || ''}`, say: (lang) => `${when.date ? L.sayDate(when.date, lang) : (sw(lang) ? 'leo' : 'today')}${when.time ? (sw(lang) ? ` ${swT(when.time, lang)}` : ` at ${when.time}`) : ''}` };
  }
  const days = profile.hoursSchedule?.days;
  if (!days) return { key: 'working_hours', say: (lang) => (sw(lang) ? 'wakati wa saa za kazi' : 'during working hours') };
  const p = L.eatParts(now); const hhmm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  const today = days[KEYS[p.dow]];
  if (today && !today.closed && today.open && today.close && hhmm < today.close && hhmm >= today.open) {
    return { key: `today<${today.close}`, say: (lang) => (sw(lang) ? `leo kabla ya ${swT(today.close, lang)}` : `today before ${today.close}`) };
  }
  if (today && !today.closed && today.open && hhmm < today.open) {
    return { key: `today>=${today.open}`, say: (lang) => (sw(lang) ? `leo kuanzia ${swT(today.open, lang)}` : `today from ${today.open}`) };
  }
  for (let i = 1; i <= 7; i += 1) {
    const dow = (p.dow + i) % 7; const h = days[KEYS[dow]];
    if (h && !h.closed && h.open) {
      const label = (lang) => (i === 1 ? (sw(lang) ? 'kesho' : 'tomorrow') : L.cap((sw(lang) ? L.DOW_SW : L.DOW_EN)[dow]));
      return { key: `d+${i}>=${h.open}`, say: (lang) => (sw(lang) ? `${label(lang)} kuanzia ${swT(h.open, lang)}` : `${label(lang)} from ${h.open}`) };
    }
  }
  return { key: 'working_hours', say: (lang) => (sw(lang) ? 'wakati wa saa za kazi' : 'during working hours') };
}
// "0712 345 678" read in groups; never a raw +254 string.
function sayPhone(phone) {
  let d = digits(phone);
  if (!d) return null;
  if (d.startsWith('254') && d.length === 12) d = `0${d.slice(3)}`;
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d;
}

// Receipt sink: never throws, never blocks the caller's line.
function makeRecorder(handlers, state) {
  return function record(phase, p, extra = {}) {
    const rec = { path: 'v2', tool: receiptTool(p), phase, confirmToken: p.token || null, tokenIssuedTurn: p.issuedTurn ?? null, tokenConfirmedTurn: extra.confirmedTurn ?? null, idempotencyKey: p.idemKey, slots: normSlots(p), validators: p.validators || {}, turnIndex: state.turn, ...extra };
    delete rec.confirmedTurn;
    (state.writeReceipts = state.writeReceipts || []).push(rec);
    try { const r = handlers?.recordWriteReceipt?.(rec); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* never throws */ }
    return rec;
  };
}

module.exports = { commitSafetyEnabled, normSlots, slotHash, receiptTool, idempotencyKey, explicitYes, callbackWhen, sayPhone, makeRecorder };
