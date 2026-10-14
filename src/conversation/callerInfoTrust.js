'use strict';

// CALLER_INFO_P1 (with BRAIN_TRUST_P1): caller-info handling design
// (briefs/caller-info-*.md, Alvin 14 Oct 10:11). Generic and driven by tenant
// settings; no tenant, place or person data lives here.
//
//  - change/cancel: only this caller's open visits, named, explicit yes to cancel
//  - availability guard, receipt-type match, all-item read-back
//  - per-tenant required fields, one question per turn
//  - summary read-back + yes before a costed save
//  - cross-call duplicate + idempotency key
//  - complaints (EN/SW): record + owner alert + no refund promise
//  - structured owner handover note; honest callback line on alert failure
//  - phone read-back in 07xx xxx xxx chunks
//  - partial slots saved on hangup
//  - caller SMS from saved data, caller language, GSM-7 <= 160, in-call yes

const crypto = require('crypto');

function on() {
  return (
    String(process.env.BRAIN_TRUST_P1 || '').trim() === 'on' &&
    String(process.env.CALLER_INFO_P1 || '').trim() === 'on'
  );
}

function sw(language) {
  return /^(?:sw|sheng)/i.test(String(language || ''));
}

function trust(state) {
  if (!state) return {};
  if (!state.trust) state.trust = {};
  return state.trust;
}

function clean(v, max = 200) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function phoneKey(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
}

const YES = /^(?:\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|correct|right|that'?s right|go ahead|please do|do it|ndio|ndiyo|eeh|ee|sawa|naam|kweli|endelea|fanya hivyo|haya)\b[\s,.!]*)+(?:please|tafadhali|cancel it|save it|send it|book it)?[\s.!]*$/i;
const NO = /^\s*(?:no|nope|nah|not that|don'?t|do not|hapana|la|acha|usi\w*|siyo|si hiyo|wait|ngoja)\b/i;

function isYes(text) {
  return YES.test(String(text || '').trim());
}
function isNo(text) {
  return NO.test(String(text || '').trim());
}

// ---------------------------------------------------------- visit labels

const WEEKDAY_EN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const WEEKDAY_SW = { mon: 'Jumatatu', tue: 'Jumanne', wed: 'Jumatano', thu: 'Alhamisi', fri: 'Ijumaa', sat: 'Jumamosi', sun: 'Jumapili' };
const DAY_WORDS = {
  mon: /\b(?:monday|jumatatu)\b/i,
  tue: /\b(?:tuesday|jumanne)\b/i,
  wed: /\b(?:wednesday|jumatano)\b/i,
  thu: /\b(?:thursday|alhamisi)\b/i,
  fri: /\b(?:friday|ijumaa)\b/i,
  sat: /\b(?:saturday|jumamosi)\b/i,
  sun: /\b(?:sunday|jumapili)\b/i,
};

function eatWeekday(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 3 * 3600000);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
}

function eatDateKey(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t + 3 * 3600000).toISOString().slice(0, 10);
}

/** "carpet cleaning on Friday" / "carpet cleaning Ijumaa". */
function visitLabel(visit, language = 'en') {
  const service = clean(visit?.service_name || visit?.serviceName || '', 60) || (sw(language) ? 'ziara' : 'visit');
  const day = eatWeekday(visit?.window_start);
  const dayText = day ? (sw(language) ? WEEKDAY_SW[day] : WEEKDAY_EN[day]) : clean(visit?.when_text || '', 40);
  if (!dayText) return service;
  return sw(language) ? `${service} ${dayText}` : `${service} on ${dayText}`;
}

function wordsOf(s) {
  return new Set(String(s || '').toLowerCase().match(/\p{L}{3,}/gu) || []);
}

function sameService(a, b) {
  const x = wordsOf(a);
  const y = wordsOf(b);
  if (!x.size || !y.size) return false;
  for (const w of x) if (y.has(w) && !['cleaning', 'service', 'usafi'].includes(w)) return true;
  return [...x].join(' ') === [...y].join(' ');
}

/** This caller's open visits (tenant-wide list filtered by caller phone). */
function callerOpenVisits(openAppointments = [], callerPhone = '') {
  const key = phoneKey(callerPhone);
  if (!key) return [];
  return (Array.isArray(openAppointments) ? openAppointments : []).filter(
    (a) => a && phoneKey(a.caller_phone) === key && ['requested', 'confirmed'].includes(String(a.status || 'requested').toLowerCase())
  );
}

/** Pick visits the caller named by day word or service words. */
function matchVisits(visits, text) {
  const raw = String(text || '');
  let out = visits;
  const day = Object.keys(DAY_WORDS).find((k) => DAY_WORDS[k].test(raw));
  if (day) out = out.filter((v) => eatWeekday(v.window_start) === day);
  const named = out.filter((v) => sameService(v.service_name, raw));
  if (named.length) out = named;
  return out;
}

function listLine(visits, language) {
  const labels = visits.slice(0, 3).map((v) => visitLabel(v, language));
  const joined = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ${sw(language) ? 'au' : 'or'} ${labels[labels.length - 1]}` : labels[0];
  return sw(language) ? `Una ziara ${visits.length}: ${joined}. Ni ipi?` : `You have ${visits.length} visits: ${joined}. Which one?`;
}

/**
 * P0-1: resolve an update/cancel against this caller's open visits only.
 * Returns { ok:true, value, visit } or { ok:false, code, line, missingSlots }.
 * A cancel needs an explicit yes first (state.trust.pendingCancel).
 */
function resolveVisitChange(value, { openAppointments = [], callerPhone = '', callerText = '', state = null, language = 'en', confirmedCancel = false } = {}) {
  const visits = callerOpenVisits(openAppointments, callerPhone);
  const t = trust(state);
  if (!visits.length) {
    return { ok: false, code: 'no_open_visit', line: sw(language) ? 'Sioni ziara iliyo wazi kwa namba hii.' : "I can't see an open visit for this number." };
  }
  let target = null;
  if (value.appointmentId) {
    target = visits.find((v) => String(v.id) === String(value.appointmentId)) || null;
    if (!target) {
      return { ok: false, code: 'not_callers_visit', line: sw(language) ? 'Sioni ziara hiyo kwa namba hii.' : "I can't find that visit for this number." };
    }
  } else {
    const named = matchVisits(visits, `${callerText} ${value.serviceName || ''}`);
    if (visits.length === 1) target = visits[0];
    else if (named.length === 1) target = named[0];
    else return { ok: false, code: 'which_visit', line: listLine(named.length ? named : visits, language), missingSlots: ['appointmentId'] };
  }
  const next = { ...value, appointmentId: String(target.id) };
  // P3: a notes-only "change my booking" is not an update.
  if (!next.status && !next.whenText && !next.landmark) {
    return { ok: false, code: 'what_to_change', line: sw(language) ? `Ungependa kubadilisha nini kwenye ${visitLabel(target, language)}, siku au saa?` : `What would you like to change on your ${visitLabel(target, language)}, the day or the time?`, missingSlots: ['when_text'] };
  }
  // P0-4: an address change on an existing visit goes to an owner callback.
  if (next.landmark) {
    return { ok: false, code: 'address_change_owner', visit: target, line: '' };
  }
  if (next.status === 'cancelled') {
    const pending = t.pendingCancel;
    if (!(confirmedCancel && pending && String(pending.id) === String(target.id))) {
      t.pendingCancel = { id: String(target.id), label: visitLabel(target, language) };
      return {
        ok: false,
        code: 'confirm_cancel',
        line: sw(language)
          ? `Nifute ${visitLabel(target, language)}? Sema ndio nifute.`
          : `Cancel your ${visitLabel(target, language)}? Say yes to cancel it.`,
      };
    }
    t.pendingCancel = null;
  }
  return { ok: true, value: next, visit: target };
}

/** Pre-model: a yes / no to a pending cancel. */
function planPendingCancel(state, text, language = 'en') {
  if (!on()) return null;
  const t = trust(state);
  if (!t.pendingCancel) return null;
  if (isYes(text)) {
    return { kind: 'apply', parsed: { appointmentUpdate: { appointmentId: t.pendingCancel.id, status: 'cancelled' }, trustCancelConfirmed: true, brainRescue: true } };
  }
  if (isNo(text)) {
    const label = t.pendingCancel.label;
    t.pendingCancel = null;
    return { kind: 'line', line: sw(language) ? `Sawa, ${label} bado iko.` : `Okay, your ${label} stays as it is.` };
  }
  return null;
}

function cancelledLine(visit, language = 'en') {
  return sw(language) ? `Nimefuta ${visitLabel(visit, language)}.` : `I've cancelled your ${visitLabel(visit, language)}.`;
}

function movedLine(visit, whenLabel, language = 'en') {
  const label = visitLabel(visit, language);
  if (sw(language)) return `Nimehamisha ${label}${whenLabel ? ` hadi ${whenLabel}` : ''}.`;
  return `I've moved your ${label}${whenLabel ? ` to ${whenLabel}` : ''}.`;
}

// ------------------------------------------------------ speech guards

/** Availability / stock claims (EN + SW). */
const AVAILABILITY_CLAIM = /\b(?:(?:is|are|it'?s|they'?re)\s+(?:in stock|available)|in stock|we (?:do )?have (?:it|that|this|those|them|one|some|plenty|enough|stock)|we'?ve got (?:it|that|those|them|some)|tunayo|tunazo|tuko nayo|tunacho|zipo|ipo stock|inapatikana|zinapatikana|vipo)\b/i;

/** Claim type of a success sentence; matched against receipt actions. */
function claimKind(sentence) {
  const s = String(sentence || '');
  if (/\b(?:cancel(?:l?ed)?|nimefuta|imefutwa|tumefuta)\b/i.test(s)) return 'cancel';
  if (/\b(?:moved|rescheduled|nimehamisha|imehamishwa)\b/i.test(s)) return 'move';
  if (/\b(?:book(?:ed)?|visit|appointment|ziara|fundi|scheduled|tumepanga|nimepanga|imepangwa|imethibitishwa|confirmed)\b/i.test(s)) return 'visit';
  if (/\b(?:order(?:ed)?|held|reserved|hold|oda|nimekuwekea|nimeshikilia)\b/i.test(s)) return 'order';
  if (/\b(?:passed|told|informed|sent|message|ujumbe|nimetuma|nimemjulisha|call you back|atakupigia)\b/i.test(s)) return 'message';
  return 'generic';
}

const EXTRA_SUCCESS = /\b(?:imethibitishwa|tumepanga|nimepanga|imepangwa|nimekuwekea|i(?:'ve| have) (?:confirmed|arranged|put you down)|(?:is|are|has been) confirmed|you'?re (?:booked|all set|confirmed))\b/i;

function receiptMatchesClaim(kind, receipts) {
  const rows = Array.isArray(receipts) ? receipts : [];
  const any = (fn) => rows.some(fn);
  const type = (r) => String(r?.value?.type || r?.requestType || r?.record?.request_type || '').toLowerCase();
  const status = (r) => String(r?.appointmentStatus || r?.value?.status || r?.record?.status || '').toLowerCase();
  switch (kind) {
    case 'cancel':
      return any((r) => r.action === 'update_appointment' && status(r) === 'cancelled');
    case 'move':
      return any((r) => r.action === 'update_appointment' && status(r) !== 'cancelled');
    case 'visit':
      return any((r) => r.action === 'create_appointment' || (r.action === 'update_appointment' && status(r) !== 'cancelled') || (r.action === 'create_service_request' && /book|visit|appointment/.test(type(r))));
    case 'order':
      return any((r) => r.action === 'create_service_request' && /order|hold|pickup/.test(type(r)));
    case 'message':
      return any((r) => r.action === 'escalate' || (r.action === 'create_service_request' && /callback|complaint|change/.test(type(r))));
    default:
      return any((r) => r.action !== 'escalate');
  }
}

/** Refund / replacement / compensation promises (never made by the agent). */
const PROMISE_CLAIM = /\b(?:(?:we|i)(?:'ll| will| can| shall)\s+(?:refund|replace|compensate|give you (?:a |your )?(?:refund|money back|discount)|redo it (?:for )?free)|(?:full |a )?refund (?:is|will be) (?:issued|processed|given)|you(?:'ll| will) (?:get|receive) (?:a |your )?(?:refund|money back|replacement)|tutakurudishia|nitakurudishia|tutabadilisha bure|utarudishiwa pesa)\b/i;

function availabilityGrounded(state, ctx = {}) {
  if (ctx.availabilityGrounded) return true;
  const ents = state?.entities || {};
  const fromCatalogue = ['product', 'item', 'requestedItem', 'service'].some((k) => {
    const e = ents[k];
    return e && /catalog|catalogue/i.test(String(e.source || ''));
  });
  return fromCatalogue && state?.conversation?.catalogueGroundedThisTurn === true;
}

/**
 * Per-sentence guard run inside trustP1.shapeSpeech. Returns
 * { keep:false, reason, replace? } to drop, or null to keep.
 */
function guardSentence(sentence, { receipts = [], state = null, language = 'en', ctx = {} } = {}) {
  if (!on()) return null;
  const s = String(sentence || '');
  if (AVAILABILITY_CLAIM.test(s) && !availabilityGrounded(state, ctx) && !/\?\s*$/.test(s)) {
    return { keep: false, reason: 'trust_availability_claim', replace: sw(language) ? 'Nitathibitisha hilo na mwenye duka.' : "Let me confirm that with the owner." };
  }
  if (PROMISE_CLAIM.test(s)) {
    return { keep: false, reason: 'trust_refund_promise', replace: sw(language) ? 'Mwenye duka ataangalia hilo na kukupigia.' : 'The owner will look into it and call you back.' };
  }
  const success = require('./trustP1').SUCCESS_WORDS.test(s) || EXTRA_SUCCESS.test(s);
  if (success && Array.isArray(receipts) && receipts.length) {
    const kind = claimKind(s);
    if (!receiptMatchesClaim(kind, receipts)) return { keep: false, reason: `trust_receipt_mismatch_${kind}` };
  }
  if (EXTRA_SUCCESS.test(s) && !(receipts || []).length) return { keep: false, reason: 'trust_success_no_receipt' };
  return null;
}

/** P1-5 one question per turn: keep the most specific (longest) question. */
function oneQuestion(sentences) {
  if (!on()) return { sentences, dropped: 0 };
  const qs = sentences.filter((s) => /\?\s*$/.test(s));
  if (qs.length < 2) return { sentences, dropped: 0 };
  const keep = qs.reduce((a, b) => (b.length > a.length ? b : a));
  return { sentences: sentences.filter((s) => !/\?\s*$/.test(s) || s === keep), dropped: qs.length - 1 };
}

// ------------------------------------------------- required fields

const FIELD_ALIASES = {
  name: 'name', jina: 'name',
  phone: 'phone', simu: 'phone',
  when: 'when', date: 'when', time: 'when', siku: 'when',
  location: 'location', address: 'location', area: 'location', place: 'location', estate: 'location',
  service: 'service', item: 'subject', product: 'subject', quantity: 'quantity', qty: 'quantity',
  email: 'email', notes: 'notes', reason: 'reason',
};

/**
 * Tenant-configured required fields for a goal, from tenant settings
 * (profile.requiredFields | profile.bookingRequiredFields |
 * businessPolicies.required_fields). Either an array (all goals) or
 * { booking: [...], order: [...], hold: [...], callback: [...] }.
 */
function tenantRequiredFields(profile = {}, goalType = '') {
  if (!on()) return [];
  const src = profile?.requiredFields || profile?.bookingRequiredFields || profile?.businessPolicies?.required_fields || profile?.businessPolicies?.requiredFields || null;
  if (!src) return [];
  let list = [];
  if (Array.isArray(src)) list = src;
  else if (typeof src === 'object') {
    const g = String(goalType || '').toLowerCase();
    const key = /book|visit|appoint/.test(g) ? 'booking' : /order/.test(g) ? 'order' : /hold/.test(g) ? 'hold' : /callback|human|message/.test(g) ? 'callback' : g;
    list = src[key] || src.all || [];
  } else if (typeof src === 'string') list = src.split(/[,;]/);
  const out = [];
  for (const raw of list) {
    const k = FIELD_ALIASES[String(raw || '').trim().toLowerCase()];
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

const FIELD_ASK = {
  en: { name: 'May I have your name?', when: 'What day and time suits you?', location: 'Which area or estate is it?', service: 'Which service do you need?', subject: 'What would you like?', quantity: 'How many do you need?', email: 'What email should we use?', reason: 'What is it about?', notes: 'Anything the team should know?', phone: 'Which number should we call you on?' },
  sw: { name: 'Naomba jina lako?', when: 'Siku gani na saa ngapi inakufaa?', location: 'Ni eneo au estate gani?', service: 'Unahitaji huduma gani?', subject: 'Ungependa nini?', quantity: 'Unahitaji ngapi?', email: 'Tutumie email gani?', reason: 'Ni kuhusu nini?', notes: 'Kuna jambo timu ijue?', phone: 'Tukupigie kwa namba gani?' },
};

function fieldFilled(field, state) {
  const e = state?.entities || {};
  const val = (k) => {
    const x = e[k];
    return x && typeof x === 'object' ? clean(x.value) : clean(x);
  };
  switch (field) {
    case 'name': return Boolean(state?.caller?.nameConfirmed || val('name'));
    case 'phone': return Boolean(state?.caller?.phone || val('phone'));
    case 'when': return Boolean(val('when'));
    case 'location': return Boolean(val('location') || val('landmark') || val('area'));
    case 'service': return Boolean(val('service') || val('product') || val('item'));
    case 'subject': return Boolean(val('product') || val('item') || val('requestedItem') || val('service'));
    case 'quantity': return Boolean(val('quantity'));
    case 'email': return Boolean(val('email'));
    default: return Boolean(val(field));
  }
}

/** Missing tenant-required fields, in tenant order. Volunteered details count as filled. */
function missingRequiredFields(profile, state) {
  const goal = String(state?.goal?.primary || state?.goal?.type || state?.intent || '');
  return tenantRequiredFields(profile, goal).filter((f) => !fieldFilled(f, state));
}

function requiredFieldHint(profile, state, language = 'en') {
  if (!on()) return '';
  const missing = missingRequiredFields(profile, state);
  if (!missing.length) return '';
  const ask = (sw(language) ? FIELD_ASK.sw : FIELD_ASK.en)[missing[0]] || '';
  return `- Tenant required fields still missing: ${missing.join(', ')}. Ask ONE now: "${ask}" Keep every detail the caller already gave. Do not save until all are in.`;
}

// ----------------------------------------- summary read-back before save

/** A save is "costed" when it books a visit, has a catalogue price, or a quantity above 1. */
function isCostedSave(parsed, profile = {}) {
  if (!parsed) return false;
  if (parsed.appointment) return true;
  const sr = parsed.serviceRequest;
  if (!sr) return false;
  const type = String(sr.type || '').toLowerCase();
  if (['callback', 'complaint', 'address_change', 'payment_change', 'enquiry'].includes(type)) return false;
  const qty = Number(sr.quantity || 0);
  if (qty > 1) return true;
  const item = String(sr.item || '').toLowerCase();
  const rows = [...(profile?.productCatalog || []), ...(profile?.servicesCatalog || [])];
  return rows.some((r) => {
    const title = String(r?.title || r?.name || '').toLowerCase();
    return title && item && (title.includes(item) || item.includes(title)) && (r.price != null || r.price_range);
  });
}

function saveSummaryLine(parsed, language = 'en', whenLabel = '') {
  const a = parsed.appointment;
  const sr = parsed.serviceRequest;
  const parts = [];
  if (a) {
    parts.push(clean(a.serviceName || a.service || '', 60));
    parts.push(whenLabel || clean(a.whenText || a.when_text || '', 60));
    const place = clean(a.landmark || a.addressLandmark || a.location || '', 60);
    if (place) parts.push(place);
  } else if (sr) {
    const items = Array.isArray(sr.items) && sr.items.length ? sr.items : [{ item: sr.item, quantity: sr.quantity }];
    parts.push(items.map((i) => [clean(i.quantity, 6), clean(i.item, 60)].filter(Boolean).join(' ')).filter(Boolean).join(', '));
    if (sr.whenText) parts.push(clean(sr.whenText, 60));
  }
  const body = parts.filter(Boolean).join(', ');
  return sw(language) ? `Kwa ufupi: ${body}. Nihifadhi hivyo?` : `So that's ${body}. Shall I save it?`;
}

/**
 * P1-6: hold a costed save until the caller says yes to one summary.
 * Returns null (go ahead) or { line } (asked; nothing written).
 */
function gateCostedSave(parsed, { state, profile, language = 'en', whenLabel = '' } = {}) {
  if (!on() || !parsed || parsed.trustSaveConfirmed || parsed.brainRescue) return null;
  if (!isCostedSave(parsed, profile)) return null;
  const t = trust(state);
  const key = saveKey(parsed);
  if (t.saveConfirmedKey && t.saveConfirmedKey === key) return null;
  t.pendingSave = { key, parsed: JSON.parse(JSON.stringify({ appointment: parsed.appointment || null, serviceRequest: parsed.serviceRequest || null })) };
  return { line: saveSummaryLine(parsed, language, whenLabel) };
}

function saveKey(parsed) {
  const a = parsed?.appointment;
  const sr = parsed?.serviceRequest;
  const base = a ? ['visit', a.serviceName || a.service, a.whenText || a.when_text, a.landmark] : ['req', sr?.type, sr?.item, sr?.quantity, sr?.whenText];
  return base.map((x) => clean(x, 80).toLowerCase()).join('|');
}

/** Pre-model: yes → apply the held save; no → ask what to change. */
function planPendingSave(state, text, language = 'en') {
  if (!on()) return null;
  const t = trust(state);
  if (!t.pendingSave) return null;
  if (isYes(text)) {
    const held = t.pendingSave;
    t.pendingSave = null;
    t.saveConfirmedKey = held.key;
    const parsed = { trustSaveConfirmed: true };
    if (held.parsed.appointment) parsed.appointment = held.parsed.appointment;
    if (held.parsed.serviceRequest) parsed.serviceRequest = held.parsed.serviceRequest;
    return { kind: 'apply', parsed };
  }
  if (isNo(text)) {
    t.pendingSave = null;
    return { kind: 'line', line: sw(language) ? 'Sawa. Nibadilishe nini?' : 'Okay. What should I change?' };
  }
  // Anything else (a correction) clears the hold; the model re-plans with the new detail.
  t.pendingSave = null;
  return null;
}

// -------------------------------------------------- duplicates + keys

/** Idempotency key: caller + item + EAT day. */
function idempotencyKey({ tenantId = '', phone = '', item = '', day = '' } = {}) {
  const raw = [tenantId, phoneKey(phone), clean(item, 80).toLowerCase(), day].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

/** Same caller + same service + same day open visit → duplicate. */
function duplicateVisit(value, { openAppointments = [], callerPhone = '' } = {}) {
  if (!on()) return null;
  const visits = callerOpenVisits(openAppointments, callerPhone);
  const day = eatDateKey(value?.windowStart || value?.window_start);
  return visits.find((v) => sameService(v.service_name, value?.serviceName || value?.service) && (!day || eatDateKey(v.window_start) === day || !v.window_start)) || null;
}

/** Same caller + item (+ day) open request (card.openRequests) → duplicate. */
function duplicateRequest(value, { openRequests = [] } = {}) {
  if (!on()) return null;
  const item = clean(value?.item, 80).toLowerCase();
  const type = clean(value?.type, 30).toLowerCase();
  if (!item) return null;
  return (Array.isArray(openRequests) ? openRequests : []).find((r) => {
    const st = String(r?.status || 'open').toLowerCase();
    if (!['open', 'new', 'pending', 'requested'].includes(st)) return false;
    const rt = String(r?.request_type || r?.type || '').toLowerCase();
    if (type && rt && rt !== type) return false;
    return sameService(r?.item, item);
  }) || null;
}

/** Fingerprint without notes, so a reworded note is not a second row. */
function contentFingerprint(action, value = {}) {
  const v = { ...value };
  delete v.notes;
  delete v.__trustMissingSlot;
  return `${action}:${crypto.createHash('sha1').update(JSON.stringify(v, Object.keys(v).sort())).digest('hex').slice(0, 16)}`;
}

// ------------------------------------------------------------ complaints

const COMPLAINT = /\b(?:complain(?:t|ing)?|not happy|unhappy|disappointed|bad service|poor service|terrible|awful|rude|damaged|broke(?:n)?|ruined|was wrong|were wrong|is wrong|wrong (?:item|order|size|colou?r)|didn'?t (?:come|show|arrive|clean)|never (?:came|showed|arrived)|no ?show|still dirty|stain(?:s)? (?:is|are) still|malalamiko|nalalamika|sijaridhika|sijafurahi|mmeniharibia|mmeharibu|imeharibika|kitu kibaya|huduma mbaya|hamkuja|hawakuja|haikufika|mbaya sana|uchafu bado)\b/i;

function isComplaint(text) {
  return on() && COMPLAINT.test(String(text || ''));
}

/** Pre-model complaint plan: record + owner alert; never a promise. */
function planComplaint(state, text, language = 'en') {
  if (!isComplaint(text)) return null;
  const t = trust(state);
  if (t.complaintSaved) return null;
  t.complaintSaved = true;
  if (state) state.intent = 'complaint';
  const name = state?.caller?.nameConfirmed ? clean(state.caller.name, 80) : '';
  return {
    kind: 'apply',
    parsed: {
      serviceRequest: {
        type: 'callback',
        name: name || 'Caller',
        item: 'complaint',
        whenText: sw(language) ? 'leo' : 'today',
        notes: clean(`Complaint: ${text}`, 300),
      },
      brainRescue: true,
      trustComplaint: true,
    },
    line: sw(language)
      ? 'Pole sana kwa hilo. Nimeandika malalamiko yako, na mwenye duka atakupigia leo kuangalia. Siwezi kuahidi kurudishiwa pesa, lakini wataangalia.'
      : "I'm sorry about that. I've noted your complaint, and the owner will call you back today to look into it. I can't promise a refund, but they will look into it.",
    failLine: sw(language)
      ? 'Pole sana. Sikuweza kuhifadhi sasa hivi; tafadhali piga tena au mwenye duka atakupigia.'
      : "I'm sorry about that. I couldn't save it just now, so please call again if you don't hear from the owner today.",
  };
}

// --------------------------------------------------- handover note

function whenOf(state) {
  const w = state?.entities?.when;
  return clean(w && typeof w === 'object' ? w.value : w, 80);
}

/** P1-9: structured owner handover note (Ops §5). Plain text, no secrets. */
function handoverNote({ state = {}, phone = '', reason = '', returning = false, quotedPrice = '', promise = '' } = {}) {
  const ents = state?.entities || {};
  const v = (k) => clean(ents[k] && typeof ents[k] === 'object' ? ents[k].value : ents[k], 80);
  const name = state?.caller?.nameConfirmed ? clean(state.caller.name, 60) : '';
  const lines = [
    `Caller: ${name || 'not confirmed'}${phone ? ` (${phone})` : ''}${returning ? ', returning' : ', new'}`,
    `Wants: ${clean(reason || state?.goal?.description || state?.intent || 'call back', 140)}`,
  ];
  const urgency = /\b(?:urgent|emergency|now|asap|haraka|sasa hivi|dharura)\b/i.test(String(reason || state?.goal?.description || '')) ? 'urgent' : whenOf(state) ? 'by the time asked' : 'whenever';
  lines.push(`Urgency: ${urgency}`);
  const details = [['Item', v('product') || v('item') || v('service')], ['Qty', v('quantity')], ['Where', v('location') || v('landmark')], ['When', whenOf(state)]].filter(([, x]) => x);
  if (details.length) lines.push(`Details: ${details.map(([k, x]) => `${k} ${x}`).join('; ')}`);
  const flags = [];
  if (quotedPrice) flags.push(`price quoted ${quotedPrice}`);
  if (state?.trust?.changeTasks?.length) flags.push('address/payment change asked (needs owner)');
  if (state?.trust?.complaintSaved) flags.push('complaint');
  if (flags.length) lines.push(`Flags: ${flags.join('; ')}`);
  lines.push(`Promised: ${clean(promise || 'owner calls back', 80)}`);
  return lines.join('\n');
}

/** Honest caller line after a handover attempt. */
function handoverCallerLine({ alerted, callbackSaved, language = 'en' } = {}) {
  if (alerted) return sw(language) ? 'Nimempa ujumbe. Atakupigia leo.' : "I've passed it on. They'll call you back today.";
  if (callbackSaved) return sw(language) ? 'Sikuweza kuwafikia sasa hivi, lakini nimeandika ombi la kupigiwa. Timu itakupigia.' : "I couldn't reach them just now, but I've saved a callback request. The team will call you back.";
  return sw(language) ? 'Sikuweza kuwafikia sasa hivi. Tafadhali piga tena baadaye.' : "I couldn't reach them just now. Please call again a little later.";
}

// -------------------------------------------------------------- phones

/** "0712345678" → "0 7 1 2, 3 4 5, 6 7 8" (07xx xxx xxx chunks). */
function chunkPhoneForSpeech(digits) {
  let d = String(digits || '').replace(/\D/g, '');
  if (/^254\d{9}$/.test(d)) d = `0${d.slice(3)}`;
  if (!/^0\d{9}$/.test(d)) return '';
  const g = [d.slice(0, 4), d.slice(4, 7), d.slice(7)];
  return g.map((x) => x.split('').join(' ')).join(', ');
}

/** Rewrite Kenyan phone numbers in TTS text into chunks. */
function chunkPhonesInText(text) {
  if (!on()) return text;
  return String(text || '').replace(/(?<![\d])(?:\+?254[\s-]?|0)(?:7|1)(?:[\s-]?\d){8}(?![\d])/g, (m) => chunkPhoneForSpeech(m) || m);
}

// ---------------------------------------------------- partial on hangup

/**
 * P1-11: on hangup with an active goal, some slots and no receipt, save one
 * callback with what was captured. Returns a serviceRequest payload or null.
 */
function partialHangupRequest(state) {
  if (!on() || !state) return null;
  const results = [...(state.actions?.savedWork || []), ...(state.actions?.lastResults || [])];
  const receipts = require('./trustP1').receiptsOf(results);
  if (receipts.length) return null;
  if (state.trust?.partialSaved) return null;
  const ents = state.entities || {};
  const v = (k) => clean(ents[k] && typeof ents[k] === 'object' ? ents[k].value : ents[k], 80);
  const captured = [['service', v('service') || v('product') || v('item')], ['qty', v('quantity')], ['when', v('when')], ['place', v('location') || v('landmark')]].filter(([, x]) => x);
  const goal = String(state.goal?.primary || '');
  if (!captured.length || !/book|order|hold|request|callback|human/i.test(goal + ' ' + String(state.intent || ''))) return null;
  state.trust = { ...(state.trust || {}), partialSaved: true };
  return {
    type: 'callback',
    name: state.caller?.nameConfirmed ? clean(state.caller.name, 80) : 'Caller',
    item: clean(captured.find(([k]) => k === 'service')?.[1] || 'unfinished request', 80),
    whenText: v('when') || '',
    notes: clean(`Call ended before saving. Captured: ${captured.map(([k, x]) => `${k} ${x}`).join('; ')}. Owner to call back.`, 300),
  };
}

// ----------------------------------------------------------- caller SMS

const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

function toGsm7(text) {
  const map = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' };
  let out = String(text || '').replace(/[’‘“”–—… ]/g, (c) => map[c] || ' ');
  out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  out = [...out].filter((c) => GSM7.test(c)).join('');
  return out.replace(/\s+/g, ' ').trim();
}

/** Caller SMS body from the saved row, in the caller's language, GSM-7, ≤160. */
function callerSmsBody(event, language = 'en') {
  const biz = clean(event?.businessName, 30) || (sw(language) ? 'Sisi' : 'Us');
  const item = clean(event?.item, 40);
  let when = clean(event?.whenLabel || '', 40);
  if (!when && event?.windowStart) {
    const day = eatWeekday(event.windowStart);
    const t = new Date(Date.parse(event.windowStart) + 3 * 3600000);
    const mins = t.getUTCHours() * 60 + t.getUTCMinutes();
    const clock = require('./appointmentHours').swahiliClockWords(mins);
    const h12 = ((t.getUTCHours() + 11) % 12) + 1;
    const mm = t.getUTCMinutes() ? `:${String(t.getUTCMinutes()).padStart(2, '0')}` : '';
    when = sw(language) ? `${WEEKDAY_SW[day] || ''} ${clock}`.trim() : `${WEEKDAY_EN[day] || ''} ${h12}${mm}${t.getUTCHours() >= 12 ? 'pm' : 'am'}`.trim();
  }
  if (!when) when = clean(event?.when, 40);
  const kind = String(event?.kind || '');
  let body;
  if (sw(language)) {
    if (/cancel/i.test(kind)) body = `${biz}: Ziara yako${item ? ` ya ${item}` : ''}${when ? ` ${when}` : ''} imefutwa.`;
    else if (/appointment|visit/i.test(kind)) body = `${biz}: Tumepokea ombi la ziara${item ? ` ya ${item}` : ''}${when ? `, ${when}` : ''}. Timu itathibitisha.`;
    else if (/callback/i.test(kind)) body = `${biz}: Tumepokea ujumbe wako. Tutakupigia.`;
    else body = `${biz}: Tumepokea ombi lako${item ? `: ${item}` : ''}${when ? `, ${when}` : ''}. Timu itathibitisha.`;
  } else if (/cancel/i.test(kind)) body = `${biz}: Your ${item || 'visit'}${when ? ` on ${when}` : ''} is cancelled.`;
  else if (/appointment|visit/i.test(kind)) body = `${biz}: We got your visit request${item ? ` for ${item}` : ''}${when ? `, ${when}` : ''}. The team will confirm.`;
  else if (/callback/i.test(kind)) body = `${biz}: We got your message. We will call you back.`;
  else body = `${biz}: We got your request${item ? `: ${item}` : ''}${when ? `, ${when}` : ''}. The team will confirm.`;
  body = toGsm7(body);
  return body.length > 160 ? `${body.slice(0, 157).trimEnd()}...` : body;
}

const SMS_OFFER = /\b(?:send (?:you )?(?:an? )?(?:sms|text)|text you|nikutumie (?:sms|ujumbe)|tukutumie (?:sms|ujumbe))\b[^?]*\?/i;

/** Track an in-call yes to the SMS offer. */
function noteSmsConsent(state, { lastAgentText = '', text = '' } = {}) {
  if (!on() || !state) return;
  if (!SMS_OFFER.test(String(lastAgentText || ''))) return;
  if (isYes(text)) trust(state).smsConsent = true;
  else if (isNo(text)) trust(state).smsConsent = false;
}

function smsOfferLine(language = 'en') {
  return sw(language) ? 'Nikutumie SMS ya uthibitisho?' : 'Shall I send you an SMS confirmation?';
}

module.exports = {
  on,
  isYes,
  isNo,
  visitLabel,
  callerOpenVisits,
  resolveVisitChange,
  planPendingCancel,
  cancelledLine,
  movedLine,
  AVAILABILITY_CLAIM,
  PROMISE_CLAIM,
  claimKind,
  receiptMatchesClaim,
  guardSentence,
  oneQuestion,
  tenantRequiredFields,
  missingRequiredFields,
  requiredFieldHint,
  isCostedSave,
  gateCostedSave,
  planPendingSave,
  saveSummaryLine,
  idempotencyKey,
  duplicateVisit,
  duplicateRequest,
  contentFingerprint,
  isComplaint,
  planComplaint,
  handoverNote,
  handoverCallerLine,
  chunkPhoneForSpeech,
  chunkPhonesInText,
  partialHangupRequest,
  callerSmsBody,
  toGsm7,
  noteSmsConsent,
  smsOfferLine,
  eatDateKey,
};
