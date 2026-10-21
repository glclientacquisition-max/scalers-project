'use strict';
// A4: one owner summary per call. Brain builds the typed `call.summary.ready`
// event from what was actually written plus read-back evidence; Ops' sender
// consumes it (dedup, channel, settle, billing). Contract:
// docs/explanation/brain/CALL_SUMMARY_EVENT.md (schemaVersion 1).
// Pure builder + validator + v1 receipt adapter. Behind CALL_SUMMARY_EVENT
// (off by default). Nothing here sends a message.

const EVENT_NAME = 'call.summary.ready';
const SCHEMA_VERSION = 1;
const OUTCOMES = ['booked', 'ordered', 'callback_needed', 'info_only', 'abandoned', 'missed', 'escalated'];
const RECEIPT_TYPES = ['booking', 'order', 'callback', 'quote', 'complaint', 'escalation'];
const RECEIPT_STATUS = ['confirmed', 'unconfirmed'];
const SLOT_STATUS = ['given', 'not_given'];
const STOCK = ['in_stock', 'out_of_stock', 'unconfirmed'];
// Receipts whose confirmation is the backend outcome itself (the caller's own
// report or ask), not a read-back of a transaction.
const NO_READBACK_TYPES = new Set(['callback', 'complaint', 'escalation']);

function callSummaryEventEnabled(env) {
  const raw = env ? env.CALL_SUMMARY_EVENT : process.env.CALL_SUMMARY_EVENT;
  return /^(1|true|on|yes)$/i.test(String(raw || '').trim());
}

function clean(value, max = 120) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}
function slug(value) {
  return clean(value, 80).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}
function slot(value) {
  const v = value == null ? '' : typeof value === 'number' ? value : clean(value, 160);
  return v === '' || v == null ? { status: 'not_given' } : { value: v, status: 'given' };
}
function normLang(value) {
  return /^(sw|swahili|kiswahili|sheng)/i.test(String(value || '')) ? 'sw' : 'en';
}

// ---- catalogue facts (the only source of price and stock) -----------------

function catalogueRows(profile = {}) {
  const rows = [];
  for (const list of [profile.productCatalog, profile.servicesCatalog]) {
    if (Array.isArray(list)) for (const row of list) if (row && row.name) rows.push(row);
  }
  return rows;
}
function catalogueId(row, index) {
  return clean(row.id || row.product_id || `name:${slug(row.name)}` || `row_${index}`, 80);
}
function findCatalogueRow(profile, { id, name } = {}) {
  const rows = catalogueRows(profile);
  if (id) {
    const byId = rows.find((r, i) => catalogueId(r, i) === id || r.id === id || r.product_id === id);
    if (byId) return byId;
  }
  const want = slug(name);
  if (!want) return null;
  return rows.find((r) => slug(r.name) === want) || null;
}
function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function unitPriceFromRow(row) {
  if (!row) return undefined;
  const p = row.pricing && typeof row.pricing === 'object' ? row.pricing : {};
  const amount = toNumber(p.amount_ksh) ?? toNumber(row.price);
  const min = toNumber(p.min_ksh) ?? amount;
  const max = toNumber(p.max_ksh) ?? toNumber(row.price_max) ?? min;
  if (min == null) return undefined;
  return { min, max: max == null || max < min ? min : max, unit: clean(p.unit || row.unit || 'each', 24) || 'each' };
}
function stockFromRow(row) {
  if (!row) return 'unconfirmed';
  const raw = row.in_stock ?? row.pricing?.in_stock ?? row.stock;
  if (raw === true) return 'in_stock';
  if (raw === false) return 'out_of_stock';
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (/^(yes|true|in|in_stock|in stock|available)$/.test(s)) return 'in_stock';
  if (/^(no|false|out|out_of_stock|out of stock|sold out|unavailable)$/.test(s)) return 'out_of_stock';
  return 'unconfirmed';
}
function itemFromCatalogue(profile, { id, name, qty }) {
  const row = findCatalogueRow(profile, { id, name });
  const q = Number(qty);
  const item = {
    catalogueId: row ? catalogueId(row, 0) : null,
    name: clean(row?.name || name, 120),
    qty: Number.isInteger(q) && q > 0 ? { value: q, status: 'given' } : { status: 'not_given' },
    stock: stockFromRow(row),
  };
  const price = unitPriceFromRow(row);
  if (price) item.unitPrice = price;
  return item;
}

// ---- read-back evidence (v1 transcript) -----------------------------------

const READBACK_CUE = /\b(shall i|should i|can i (save|book|put)|do you want me to|is that (right|correct)|confirm|to confirm|so that'?s|nikuwekee|niweke|nihifadhi|nithibitishe|ni sawa\?|tuweke|niandike|nikuandikie)\b/i;
const YES_WHOLE = /^(yes|yeah|yep|yes please|yes go ahead|go ahead|please do|correct|that'?s (right|correct)|sure|okay|ok|ndio|ndiyo|ndio sawa|ndiyo sawa|sawa|sawa sawa|naam|poa|haya|eeh|ee|yes sawa|ndio tafadhali)$/i;
const NOT_YES = /\b(no|not|wait|hold on|but|let me|check|hapana|ngoja|subiri|lakini|si(o)? hivyo|bado)\b|\?/i;

function isExplicitYes(text) {
  const raw = String(text || '').trim();
  if (!raw || NOT_YES.test(raw)) return false;
  const core = raw.toLowerCase().replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return YES_WHOLE.test(core);
}
/** True when an agent read-back is followed directly by a whole-answer yes. */
function readbackConfirmedInTurns(turns) {
  const rows = Array.isArray(turns) ? turns : [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a?.speaker === 'agent' && READBACK_CUE.test(String(a.text || '')) && b?.speaker === 'caller' && isExplicitYes(b.text)) return true;
  }
  return false;
}

// ---- v1 adapter: receipts from written rows --------------------------------

function succeeded(row) {
  return row && (row.status === 'succeeded' || row.status === 'updated');
}
function parseItemText(text) {
  // "2 x Protractor, 1 x T-square" | "Protractor"
  return String(text || '')
    .split(/\s*,\s*/)
    .map((part) => {
      const m = part.match(/^\s*(\d{1,3})\s*(?:x|×|pcs?|pieces?)\s+(.+)$/i);
      return m ? { qty: Number(m[1]), name: clean(m[2]) } : { qty: null, name: clean(part) };
    })
    .filter((x) => x.name);
}
function v1Type(row) {
  if (row.action === 'create_appointment' || row.action === 'update_appointment') return 'booking';
  if (row.action === 'escalate') return 'escalation';
  const t = String(row.requestType || row.value?.type || '').toLowerCase();
  if (t === 'order' || t === 'hold') return 'order';
  if (t === 'callback' || t === 'other') return 'callback';
  if (t === 'enquiry') return 'quote';
  return 'callback';
}

function v1CallerName(state) {
  const { entityValue, isPlausibleCallerName } = require('./entityExtraction');
  const raw = clean(state?.caller?.name || entityValue(state?.entities?.name), 80);
  return raw && isPlausibleCallerName(raw) ? raw : null;
}

/**
 * Receipts for the old (v1) path. Only rows the backend actually wrote can be
 * confirmed, and a booking/order also needs a read-back + whole-answer yes in
 * the spoken transcript. Interest with no write is an unconfirmed receipt.
 */
function receiptsFromV1({ brainState, toolResults, turns, profile = {} } = {}) {
  const state = brainState || {};
  const { hangupResults } = require('./callResolution');
  const rows = hangupResults(state, toolResults).filter((r) => r && r.action && r.action !== 'save_caller_info');
  const readback = readbackConfirmedInTurns(turns);
  const callerName = v1CallerName(state);
  const out = [];
  let n = 0;
  const seen = new Set();
  for (const row of rows) {
    const type = v1Type(row);
    const written = succeeded(row);
    const rowId = written ? clean(row.id || row.record?.id || '', 80) || null : null;
    if (row.action === 'escalate' && !written && row.status !== 'failed') continue; // disabled/invalid/duplicate
    if (row.action !== 'escalate' && !written) continue; // failed writes are covered by interest below
    if (row.action === 'update_appointment' && row.appointmentStatus === 'cancelled') continue;
    const confirmed = NO_READBACK_TYPES.has(type)
      ? written && (type !== 'escalation' || !row.soft)
      : written && Boolean(rowId) && readback;
    const v = row.value || {};
    const receipt = {
      receiptId: `v1_${++n}`,
      type,
      status: confirmed ? 'confirmed' : 'unconfirmed',
      slots: {},
    };
    if (rowId) receipt.writtenRowId = rowId;
    if (type === 'booking') {
      receipt.slots.service = slot(v.serviceName || row.record?.service_name);
      receipt.slots.when = slot(v.whenText || row.record?.when_text);
      receipt.slots.place = slot(v.landmark);
    } else if (type === 'order') {
      receipt.slots.pickup = slot(v.whenText);
      receipt.items = parseItemText(v.item).map((it) => itemFromCatalogue(profile, {
        name: it.name,
        qty: it.qty ?? (toNumber(v.quantity) && parseItemText(v.item).length === 1 ? toNumber(v.quantity) : null),
      }));
    } else {
      receipt.slots.reason = slot(v.notes || v.item || row.reason);
    }
    receipt.slots.name = slot(v.name || callerName);
    seen.add(type);
    out.push(receipt);
  }
  // Interest that never reached a write (HD_8a8aa14db292): unconfirmed only.
  const intent = String(state.intent || '').toLowerCase();
  const { entityValue } = require('./entityExtraction');
  const product = entityValue(state.entities?.product) || entityValue(state.entities?.requestedItem);
  const service = entityValue(state.entities?.service);
  const wantsOrder = /^(order|hold|purchase|buy)/.test(intent) || (product && /order|hold|pickup/.test(intent));
  const wantsBooking = /^(booking|book|visit|appointment)/.test(intent);
  if (wantsOrder && !seen.has('order') && product) {
    out.push({
      receiptId: `v1_${++n}`,
      type: 'order',
      status: 'unconfirmed',
      slots: { pickup: slot(entityValue(state.entities?.when)), name: slot(callerName) },
      items: parseItemText(product).map((it) => itemFromCatalogue(profile, { name: it.name, qty: it.qty ?? toNumber(entityValue(state.entities?.quantity)) })),
    });
  } else if (wantsBooking && !seen.has('booking') && service) {
    out.push({
      receiptId: `v1_${++n}`,
      type: 'booking',
      status: 'unconfirmed',
      slots: { service: slot(service), when: slot(entityValue(state.entities?.when)), place: slot(entityValue(state.entities?.location) || entityValue(state.entities?.landmark)), name: slot(callerName) },
    });
  }
  return out;
}

/**
 * BA v2 owned the call: its receipts win. v1 adds only rows v2 did not write
 * itself (a turn that fell back to v1). v2 handoffs run the v1 escalate tool
 * too, so v2 owns handoff types (a ladder callback must not resurface as an
 * urgent v1 escalation).
 */
function mergeV2Receipts(v2Receipts = [], v1Receipts = []) {
  const v2 = Array.isArray(v2Receipts) ? v2Receipts : [];
  const v2Rows = new Set(v2.map((r) => r.writtenRowId).filter(Boolean));
  const v2Types = new Set(v2.map((r) => r.type));
  const HANDOFF = ['callback', 'complaint', 'escalation'];
  const v2Handoff = HANDOFF.some((t) => v2Types.has(t));
  const extra = (Array.isArray(v1Receipts) ? v1Receipts : []).filter((r) => {
    if (HANDOFF.includes(r.type) && v2Handoff) return false;
    return r.writtenRowId ? !v2Rows.has(r.writtenRowId) : !v2Types.has(r.type);
  });
  return [...v2, ...extra].map((r, i) => ({ ...r, receiptId: `r_${i + 1}` }));
}

// ---- builder ---------------------------------------------------------------

function deriveOutcome({ answered, receipts, infoAnswered }) {
  if (answered === false) return 'missed';
  const has = (type, status) => receipts.some((r) => r.type === type && (!status || r.status === status));
  if (has('escalation')) return 'escalated';
  if (has('booking', 'confirmed')) return 'booked';
  if (has('order', 'confirmed')) return 'ordered';
  if (has('callback') || has('complaint') || has('quote', 'confirmed')) return 'callback_needed';
  if (!receipts.length && !infoAnswered) return 'abandoned';
  return 'info_only';
}

/**
 * Pure: build + validate the event. Never throws.
 * @returns {{ ok: boolean, event: object|null, errors: string[] }}
 */
function buildCallSummaryEvent(input = {}) {
  const receipts = (Array.isArray(input.receipts) ? input.receipts : []).map((r, i) => ({
    ...r,
    receiptId: clean(r.receiptId || `r_${i + 1}`, 40),
  }));
  if (input.answered === false) receipts.length = 0; // a missed call has no receipts
  const outcome = deriveOutcome({ answered: input.answered, receipts, infoAnswered: Boolean(input.infoAnswered) });
  const escalation = receipts.find((r) => r.type === 'escalation');
  const e164 = clean(input.caller?.e164 || input.caller?.phone || '', 32) || null;
  const name = clean(input.caller?.name || '', 80);
  const event = {
    event: EVENT_NAME,
    schemaVersion: SCHEMA_VERSION,
    path: input.path === 'v2' ? 'v2' : 'v1',
    callLanguage: normLang(input.callLanguage),
    callId: clean(input.callId, 80) || null,
    tenantId: clean(input.tenantId, 80) || null,
    outcome,
    urgent: Boolean(escalation),
    // e164 is the contract name; phone mirrors it for Ops' sender spec.
    caller: { ...(name ? { name } : {}), e164, phone: e164 },
    receipts,
    ...(escalation ? { escalationReason: clean(input.escalationReason || escalation.slots?.reason?.value || 'escalation', 160) } : {}),
    emittedAt: (input.now instanceof Date ? input.now : new Date()).toISOString(),
  };
  const v = validateCallSummaryEvent(event);
  return { ok: v.ok, event: v.ok ? event : null, errors: v.errors };
}

function validateCallSummaryEvent(e) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };
  req(e && typeof e === 'object', 'event must be an object');
  if (!e || typeof e !== 'object') return { ok: false, errors };
  req(e.event === EVENT_NAME, 'event name');
  req(e.schemaVersion === SCHEMA_VERSION, 'schemaVersion must be 1');
  req(e.path === 'v1' || e.path === 'v2', 'path');
  req(e.callLanguage === 'en' || e.callLanguage === 'sw', 'callLanguage');
  req(typeof e.callId === 'string' && e.callId, 'callId required');
  req(typeof e.tenantId === 'string' && e.tenantId, 'tenantId required');
  req(OUTCOMES.includes(e.outcome), 'outcome');
  req(typeof e.urgent === 'boolean', 'urgent');
  req(e.caller && typeof e.caller === 'object', 'caller');
  req(Array.isArray(e.receipts), 'receipts');
  req(!Number.isNaN(Date.parse(e.emittedAt)), 'emittedAt');
  const hasEsc = (e.receipts || []).some((r) => r.type === 'escalation');
  req(e.urgent === hasEsc, 'urgent must equal "an escalation receipt exists"');
  if (e.outcome === 'missed') req(!(e.receipts || []).length, 'missed call carries no receipts');
  if (e.outcome === 'abandoned') req(!(e.receipts || []).length, 'abandoned call carries no receipts');
  for (const [i, r] of (e.receipts || []).entries()) {
    const at = `receipts[${i}]`;
    req(typeof r.receiptId === 'string' && r.receiptId, `${at}.receiptId`);
    req(RECEIPT_TYPES.includes(r.type), `${at}.type`);
    req(RECEIPT_STATUS.includes(r.status), `${at}.status`);
    if (r.status === 'confirmed' && !NO_READBACK_TYPES.has(r.type)) req(Boolean(r.writtenRowId), `${at} confirmed without writtenRowId`);
    req(r.slots && typeof r.slots === 'object', `${at}.slots`);
    for (const [k, s] of Object.entries(r.slots || {})) {
      req(s && SLOT_STATUS.includes(s.status), `${at}.slots.${k}.status`);
      if (s?.status === 'given') req(s.value != null && s.value !== '', `${at}.slots.${k}.value`);
      if (s?.status === 'not_given') req(s.value === undefined, `${at}.slots.${k} not_given has no value`);
    }
    if (r.items !== undefined) {
      req(Array.isArray(r.items), `${at}.items`);
      for (const [j, it] of (r.items || []).entries()) {
        const ip = `${at}.items[${j}]`;
        req(typeof it.name === 'string' && it.name, `${ip}.name`);
        req('catalogueId' in it, `${ip}.catalogueId`);
        req(it.qty && SLOT_STATUS.includes(it.qty.status), `${ip}.qty.status`);
        req(STOCK.includes(it.stock), `${ip}.stock`);
        if (it.unitPrice) req(Number.isFinite(it.unitPrice.min) && Number.isFinite(it.unitPrice.max) && it.unitPrice.max >= it.unitPrice.min && typeof it.unitPrice.unit === 'string', `${ip}.unitPrice`);
        if (!it.catalogueId) req(it.stock === 'unconfirmed' && !it.unitPrice, `${ip} off-catalogue item has no stock or price`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---- emitter ----------------------------------------------------------------

const hooks = new Set();
const lastByCall = new Map();
/** Ops' sender subscribes here. fn(event, { replaces }) */
function onCallSummaryReady(fn) {
  if (typeof fn === 'function') hooks.add(fn);
  return () => hooks.delete(fn);
}
/**
 * Emit once per call; a re-emit replaces the stored copy (`replaces: true`)
 * and the sender must not send again for that callId. Stores the latest on
 * the call row (calls.summary JSON → call_summary_event) for the Desk.
 */
async function emitCallSummaryEvent(event, { db, callSid, log = console } = {}) {
  if (!event || !event.callId) return { emitted: false, reason: 'no_event' };
  const replaces = lastByCall.has(event.callId);
  lastByCall.set(event.callId, event.emittedAt);
  if (lastByCall.size > 5000) lastByCall.delete(lastByCall.keys().next().value);
  if (db && typeof db.mergeCallSummaryMeta === 'function' && callSid) {
    try {
      await db.mergeCallSummaryMeta({ callSid, patch: { call_summary_event: event } });
    } catch (err) {
      log.warn?.(`[call-summary] store failed ${callSid}:`, err?.message || err);
    }
  }
  for (const fn of hooks) {
    try {
      await fn(event, { replaces });
    } catch (err) {
      log.warn?.(`[call-summary] hook failed ${event.callId}:`, err?.message || err);
    }
  }
  log.log?.(`[call-summary] ${EVENT_NAME} ${event.callId} path=${event.path} outcome=${event.outcome} receipts=${event.receipts.length} confirmed=${event.receipts.filter((r) => r.status === 'confirmed').length}${replaces ? ' (replaces)' : ''}`);
  return { emitted: true, replaces };
}
function _resetForTests() { hooks.clear(); lastByCall.clear(); }

module.exports = {
  EVENT_NAME,
  SCHEMA_VERSION,
  OUTCOMES,
  RECEIPT_TYPES,
  callSummaryEventEnabled,
  buildCallSummaryEvent,
  validateCallSummaryEvent,
  receiptsFromV1,
  v1CallerName,
  mergeV2Receipts,
  readbackConfirmedInTurns,
  isExplicitYes,
  itemFromCatalogue,
  stockFromRow,
  unitPriceFromRow,
  deriveOutcome,
  slot,
  normLang,
  onCallSummaryReady,
  emitCallSummaryEvent,
  _resetForTests,
};
