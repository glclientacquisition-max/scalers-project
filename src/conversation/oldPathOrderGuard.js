'use strict';
// OLD_PATH_ORDER_GUARD (default off): the live (old-path) assistant may not save an order or
// hold unless (1) every item matches the grounded product catalogue, (2) stock/availability
// for each item was answered on this call, and (3) the agent read the items back and the
// caller answered with an explicit yes (repeating the read-back counts as yes).
// Otherwise the save is dropped and the read-back is asked once; after that the save stays
// blocked with no further re-ask. Prod miss: HD_2847152f6c1e T4, where a bare "Yes, yes."
// (answering an identity question) saved "Big engineering drawing set" with no item named,
// no stock answer and no read-back. Flag off: nothing here runs and behaviour is unchanged.
const { findProductMatch, normalizeProducts } = require('./productCatalog');
const { factProducts } = require('./provenance');

const ON = /^(1|true|on|yes)$/i;
function orderGuardEnabled() { return ON.test(String(process.env.OLD_PATH_ORDER_GUARD || '').trim()); }

const GUARDED_TYPES = new Set(['order', 'hold', 'hold_or_pickup']);
const STOCK_WORDS = /\b(in stock|out of stock|available|unavailable|we have|we don'?t have|sold out|tunayo|hatuna|inapatikana|zinapatikana|haipatikani|ipo|zipo|iko|ziko|imeisha|zimeisha|stock)\b/i;
// explicit yes only: a bare "okay"/"sawa"/"alright" is an ack, not consent
const EXPLICIT_YES = /^\W*(yes|yeah|yep|yup|ndio|ndiyo|eeh ndio|sure|correct|exactly|that'?s (right|correct)|go ahead|please do|confirm(ed)?|place it|book it|weka|endelea|ni sawa(?! tu)|sawa,? (weka|endelea))\b/i;
const NEGATION = /\b(no|not|don'?t|hapana|si |sio|wait|ngoja|change|badilisha)\b/i;
const MAX_REASKS = 1;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'with', 'set', 'pack', 'ya', 'la', 'za', 'wa', 'na']);
const sigTokens = (name) => norm(name).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
// the line names the product when it carries every significant token of its name (or its matched alias)
function lineNames(line, product, matched) {
  const hay = ` ${norm(line)} `;
  return [product.name, matched].filter(Boolean).some((term) => {
    const toks = sigTokens(term);
    return toks.length > 0 && toks.every((t) => hay.includes(` ${t}`));
  });
}

function splitItems(item) {
  return String(item || '').split(/\s*(?:,|;|&|\+|\band\b|\bna\b)\s*/i).map((s) => s.replace(/^\s*\d+\s*(x|×)?\s*/i, '').trim()).filter(Boolean);
}

function orderGuardState(state) {
  if (!state.orderGuard || typeof state.orderGuard !== 'object') state.orderGuard = { agentLines: [], reasked: {} };
  if (!Array.isArray(state.orderGuard.agentLines)) state.orderGuard.agentLines = [];
  if (!state.orderGuard.reasked || typeof state.orderGuard.reasked !== 'object') state.orderGuard.reasked = {};
  return state.orderGuard;
}

/** observeCallerTurn hook: remember what the agent said before this caller turn. Flag-gated. */
function noteCallerTurn(state, { lastAgentText = '', text = '' } = {}) {
  if (!orderGuardEnabled() || !state || typeof state !== 'object') return state;
  const g = orderGuardState(state);
  const line = String(lastAgentText || '').trim();
  if (line && g.agentLines[g.agentLines.length - 1] !== line) g.agentLines.push(line);
  g.agentLines = g.agentLines.slice(-8);
  g.callerText = String(text || '').trim();
  return state;
}

/**
 * Pure decision. Returns { allow, missing[], matches[{ asked, product, matched }], unmatched[] }.
 */
function evaluateOrder({ request, productCatalog = null, fieldMeta = null, agentLines = [], callerText = '' } = {}) {
  const type = String(request?.type || '').trim().toLowerCase();
  if (!request || !GUARDED_TYPES.has(type)) return { allow: true, guarded: false, missing: [], matches: [], unmatched: [] };
  const catalog = normalizeProducts(factProducts(productCatalog, fieldMeta));
  const asked = splitItems(request.item);
  const matches = []; const unmatched = [];
  for (const a of asked) {
    const m = catalog.length ? findProductMatch(a, catalog) : null;
    // a fuzzy containment hit must still name the product: "Big engineering drawing set" is not "Drawing Set"
    if (m && (m.score >= 1000 || sigTokens(a).every((t) => sigTokens(m.matched).includes(t) || sigTokens(m.product.name).includes(t)))) matches.push({ asked: a, product: m.product, matched: m.matched });
    else unmatched.push(a);
  }
  const missing = [];
  if (!asked.length || unmatched.length) missing.push('catalog_item');
  const lines = agentLines.map(String);
  const last = lines[lines.length - 1] || '';
  if (matches.length && !matches.every((x) => lines.some((l) => STOCK_WORDS.test(l) && lineNames(l, x.product, x.matched)))) missing.push('availability');
  if (matches.some((x) => x.product.in_stock === 'no')) missing.push('out_of_stock');
  const readback = /\?\s*$/.test(last) && matches.length > 0 && matches.every((x) => lineNames(last, x.product, x.matched));
  const caller = String(callerText || '');
  const yes = EXPLICIT_YES.test(caller) && !NEGATION.test(caller.replace(EXPLICIT_YES, ''));
  const repeated = matches.length > 0 && matches.every((x) => lineNames(caller, x.product, x.matched)) && !NEGATION.test(caller)
    && (!request.quantity || norm(caller).includes(norm(request.quantity)) || !/\d/.test(String(request.quantity)));
  if (!readback || !(yes || repeated)) missing.push('readback_yes');
  return { allow: missing.length === 0, guarded: true, missing, matches, unmatched, readback, yes, repeated };
}

function stockClause(matches, sw) {
  const known = matches.filter((x) => x.product.in_stock === 'yes');
  const unknown = matches.filter((x) => x.product.in_stock !== 'yes' && x.product.in_stock !== 'no');
  const names = (xs) => xs.map((x) => x.product.name).join(sw ? ' na ' : ' and ');
  const bits = [];
  if (known.length) bits.push(sw ? `${names(known)} inapatikana.` : `${names(known)} is in stock.`);
  if (unknown.length) bits.push(sw ? `${names(unknown)}: siwezi kuthibitisha stock sasa, timu itathibitisha.` : `I can't confirm stock for ${names(unknown)} right now; the team will confirm it is available.`);
  return bits.join(' ');
}

/** The one re-ask: the read-back (with the stock answer) or, for an off-catalogue item, an item ask. */
function reaskLine(decision, request, language = 'en') {
  const sw = /^(sw|sheng)/.test(String(language || ''));
  if (decision.missing.includes('out_of_stock')) {
    const out = decision.matches.filter((x) => x.product.in_stock === 'no').map((x) => x.product.name).join(sw ? ' na ' : ' and ');
    return sw ? `Samahani, ${out} imeisha kwa sasa. Ungependa kitu kingine?` : `Sorry, ${out} is out of stock right now. Would you like something else?`;
  }
  if (decision.missing.includes('catalog_item')) {
    const what = decision.unmatched.join(sw ? ' na ' : ' and ');
    return what
      ? (sw ? `Sijapata ${what} kwenye orodha yetu. Ungependa kitu gani kutoka kwenye orodha?` : `I couldn't find ${what} on our list. Which item from our list would you like?`)
      : (sw ? 'Ungependa kitu gani kutoka kwenye orodha yetu?' : 'Which item from our list would you like?');
  }
  const qty = String(request.quantity || '').trim();
  const items = decision.matches.map((x) => (qty && decision.matches.length === 1 ? `${qty} ${x.product.name}` : x.product.name)).join(sw ? ' na ' : ' and ');
  const when = String(request.whenText || '').trim();
  const stock = decision.missing.includes('availability') ? `${stockClause(decision.matches, sw)} ` : '';
  return sw
    ? `${stock}Nithibitishe: ${items}${when ? `, ${when}` : ''}. Niweke oda?`.trim()
    : `${stock}Just to confirm: ${items}${when ? `, ${when}` : ''}. Shall I place the order?`.trim();
}

/**
 * applyGeminiTools hook. Flag off or not an order/hold: returns null and touches nothing.
 * Blocked: removes parsed.serviceRequest in place and returns the blocked tool result
 * ({ action, status:'blocked', code:'order_guard', missing, askLine }) to speak instead.
 */
function applyOrderGuard(parsed, state, profile = {}, { language } = {}) {
  if (!orderGuardEnabled() || !parsed || !parsed.serviceRequest || !state || typeof state !== 'object') return null;
  const g = orderGuardState(state);
  const callerText = g.callerText ?? String((state.conversation?.answersReceived || []).slice(-1)[0] || '');
  const decision = evaluateOrder({ request: parsed.serviceRequest, productCatalog: profile.productCatalog || null, fieldMeta: profile.fieldMeta || null, agentLines: g.agentLines, callerText });
  if (decision.allow) return null;
  const request = parsed.serviceRequest;
  delete parsed.serviceRequest;
  const key = `${String(request.type || '').toLowerCase()}|${norm(request.item)}`;
  const n = g.reasked[key] || 0;
  const lang = language || state.language?.current || 'en';
  const sw = /^(sw|sheng)/.test(String(lang));
  let askLine;
  if (n < MAX_REASKS) { g.reasked[key] = n + 1; askLine = reaskLine(decision, request, lang); }
  else askLine = sw ? 'Sijaweka oda bado.' : "I haven't placed the order yet.";
  return { action: 'create_service_request', status: 'blocked', code: 'order_guard', reason: `Order not saved: ${decision.missing.join(', ')}.`, missing: decision.missing, reasked: n < MAX_REASKS, askLine };
}

module.exports = { orderGuardEnabled, noteCallerTurn, evaluateOrder, reaskLine, applyOrderGuard, splitItems, EXPLICIT_YES };
