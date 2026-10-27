'use strict';
// C7 hybrid Gemini tool-calling (BRAIN_V2_MODEL=off|shadow|on, default off).
// The model only PROPOSES typed tool calls; it never speaks. Every proposal is checked
// against the C2 fact store, this state's allowed tools and C1's confirm token; tool
// errors come back as results, never exceptions. Templates speak.
// shadow: the rules turn stays live; the model runs beside it, off the critical path
// (never awaited by the caller's turn), under a hard cap (HARD_CAP_MS; evidence band ~1.5–2.0s), and each turn logs the
// proposal vs the rules' intent and slots (agreement, latency, timeout, tokens, cost).
// on: NOT for staging yet. Reachable only with BRAIN_V2_MODEL=on exactly.
const FS = require('../../knowledge/factStore');
const { validate, toFunctionDeclarations } = require('./catalogue');

// Evidence (2026-10-23 dry): warm tiny primary ~843ms, fat tools ~1.8s, backup warm often >2s.
// 900 + 550/350 starve caused 100% dual-timeout on HD_0be4 / HD_c170. Cap band ~1.5–2.0s.
const HARD_CAP_MS = 1800;
// C7 cascade (staging): primary first; on HARD_CAP timeout or hard fail, one backup within the same overall cap.
const MODEL_ID = 'gemini-3.6-flash';
const MODEL_BACKUP_ID = 'gemini-3.5-flash-lite';
// Gemini 3.5 Flash-Lite list price (plan A6): USD per token; KES at ~129/USD.
// Used for rough cost estimates on either cascade leg.
const PRICE = { inUsd: 0.30 / 1e6, cachedUsd: 0.03 / 1e6, outUsd: 2.50 / 1e6, kesPerUsd: 129 };
const HISTORY_TURNS = 6;

function modelMode(env = process.env) {
  const v = String((env || {}).BRAIN_V2_MODEL || '').trim().toLowerCase();
  if (v === 'shadow') return 'shadow';
  if (v === 'on') return 'on'; // explicit only; documented as not for staging
  return 'off';
}
function resolveModelIds(env = process.env) {
  const e = env || {};
  const primary = String(e.BRAIN_V2_MODEL_ID || '').trim() || MODEL_ID;
  const backup = String(e.BRAIN_V2_MODEL_BACKUP_ID || '').trim() || MODEL_BACKUP_ID;
  return { primary, backup };
}
void process.env.BRAIN_V2_MODEL; void process.env.BRAIN_V2_MODEL_ID; void process.env.BRAIN_V2_MODEL_BACKUP_ID;

// ---------- typed proposal tools ----------
function buildTools(facts = {}, { openRows = [] } = {}) {
  const ids = (xs) => (xs.length ? { type: 'string', enum: xs } : { type: 'string', enum: ['__none__'] });
  const serviceId = ids((facts.services || []).map((s) => s.id));
  const productId = ids((facts.products || []).map((p) => p.id));
  const rowId = ids(openRows.map((r) => r.id).filter(Boolean));
  const when = { type: 'object', additionalProperties: false, properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, raw: { type: 'string', maxLength: 80 } } };
  const place = { type: 'object', additionalProperties: false, properties: { text: { type: 'string', maxLength: 80 } } };
  const token = { type: 'string', pattern: '^ct_[a-z0-9]+$' };
  const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
  return {
    propose_booking: { kind: 'write', intent: 'book', description: 'Propose a visit from the typed service list. The server reads it back; only the confirm_token from the caller\'s explicit yes commits.', parameters: obj({ service_id: serviceId, when, place, name: { type: 'string', minLength: 2, maxLength: 60 }, confirm_token: token }, ['service_id']) },
    propose_order: { kind: 'write', intent: 'order', description: 'Propose a pickup order of catalogue products with quantities.', parameters: obj({ items: { type: 'array', minItems: 1, maxItems: 10, items: obj({ product_id: productId, qty: { type: 'integer', minimum: 1, maximum: 999 } }, ['product_id', 'qty']) }, pickup: when, confirm_token: token }, ['items']) },
    propose_quote: { kind: 'write', intent: 'price', description: 'The caller wants a quote the list cannot give (no typed price): ask the owner to quote.', parameters: obj({ service_id: serviceId, notes: { type: 'string', maxLength: 200 } }) },
    propose_callback: { kind: 'write', intent: 'callback', description: 'Owner callback (callback, quote, manager, owner-only change, complaint).', parameters: obj({ reason: { type: 'string', enum: ['callback', 'quote', 'manager', 'owner_only_change', 'complaint'] }, when, confirm_token: token }, ['reason']) },
    get_price: { kind: 'read', intent: 'price', description: 'Typed price of one service or product (variant by id).', parameters: obj({ service_id: serviceId, product_id: productId }) },
    get_hours: { kind: 'read', intent: 'hours', description: 'Opening hours from the schedule.', parameters: obj({ day: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'today', 'week'] } }) },
    check_availability: { kind: 'read', intent: 'availability', description: 'Is a service/product offered or in stock, is an area served, is a time open.', parameters: obj({ service_id: serviceId, product_id: productId, area: { type: 'string', maxLength: 60 }, when }) },
    lookup_file: { kind: 'read', intent: 'recall', description: 'The caller\'s own open rows.', parameters: obj({ topic: { type: 'string', enum: ['open_tasks', 'last_visit', 'orders'] }, row_id: rowId }, ['topic']) },
    end_call: { kind: 'control', intent: 'end', description: 'The caller is done; the server plays the goodbye.', parameters: obj({ reason: { type: 'string', enum: ['done', 'caller_bye', 'no_response'] } }, ['reason']) },
  };
}
const WRITE_OF_PENDING = { create_booking: 'propose_booking', create_order: 'propose_order', create_handoff: 'propose_callback' };
// Per-state tool list: nothing after the end; while a read-back waits, only that write (to confirm
// with its token) and read tools, never end_call.
function allowedTools(snap = {}) {
  if (snap.ended) return [];
  const read = ['get_price', 'get_hours', 'check_availability', 'lookup_file'];
  if (snap.phase === 'readback' && snap.pendingTool) return [WRITE_OF_PENDING[snap.pendingTool] || 'propose_callback', ...read];
  return ['propose_booking', 'propose_order', 'propose_quote', 'propose_callback', ...read, 'end_call'];
}

// ---------- validation: every proposal, results not exceptions ----------
function validateProposal(call, { tools, facts, snap, allowed }) {
  const name = call && call.name;
  const def = tools[name];
  if (!def) return { ok: false, error: 'unknown_tool' };
  if (!allowed.includes(name)) return { ok: false, error: 'not_allowed_in_state' };
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const errs = validate(def.parameters, args);
  if (errs.length) {
    // an id outside the typed enums is a fact-store miss, not just bad JSON
    if (errs.some((e) => /service_id: not in enum/.test(e))) return { ok: false, error: 'unknown_service', errors: errs.slice(0, 4) };
    if (errs.some((e) => /product_id: not in enum/.test(e))) return { ok: false, error: 'unknown_product', errors: errs.slice(0, 4) };
    return { ok: false, error: 'schema_invalid', errors: errs.slice(0, 4) };
  }
  if (args.service_id && !(facts.services || []).some((s) => s.id === args.service_id)) return { ok: false, error: 'unknown_service' };
  if (def.kind === 'write') {
    if (args.confirm_token) {
      const ok = snap.phase === 'readback' && snap.pendingToken && args.confirm_token === snap.pendingToken;
      if (!ok) return { ok: false, error: 'token_mismatch' };
      return { ok: true, commit: true };
    }
    return { ok: true, commit: false }; // a proposal without a token never commits: the server reads it back
  }
  return { ok: true };
}

// ---------- request: system instruction, history, state, allowed tools, facts ----------
const PHONE = /\+?\d[\d\s-]{6,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const redact = (s) => String(s == null ? '' : s).replace(PHONE, (h) => (h.replace(/\D/g, '').length >= 7 && !ISO_DATE.test(h.trim()) ? '[phone]' : h));
function redactDeep(v) {
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}
function factsBlock(facts = {}) {
  return {
    services: (facts.services || []).slice(0, 40).map((s) => ({ id: s.id, name: s.name, variant: s.variant || undefined, price: s.price?.say || null })),
    products: (facts.products || []).slice(0, 40).map((p) => ({ id: p.id, name: p.name, price: p.price?.say || null })),
    areas: (facts.areas || []).map((a) => ({ name: a.name, fee: a.confirmed ? a.fee : null })),
    faqs: (facts.faqs || []).map((f) => f.question),
  };
}
function snapshot(state = {}) {
  const s = state.slots || {};
  return {
    turn: state.turn || 0, lang: state.lang || 'en', phase: state.phase || 'collect', intent: state.intent || null,
    expecting: state.expecting || null, ended: !!state.ended,
    pendingTool: state.pending?.tool || null, pendingToken: state.pending?.token || null,
    slots: { service: s.service || null, date: s.when?.date || null, time: s.when?.time || null, place: s.place || null, name: s.name ? 'set' : null, items: (s.items || []).map((x) => ({ product_id: x.id || x.product_id || null, name: x.name || null, qty: x.qty || null })) },
    infoRepeat: { ...(state.infoRepeat || {}) }, lastInfo: state.lastInfo || null,
  };
}
const SYSTEM = [
  'You are the understanding layer of a phone receptionist for one Kenyan business. You never speak to the caller: the server speaks fixed templates.',
  'Each turn, call at most ONE of the allowed functions that matches what the caller wants now, with ids from the business facts only. If nothing fits, call no function.',
  'Never invent services, products, prices, times or places. Write tools only propose; the server reads back and commits only with the confirm_token minted on the caller\'s explicit yes.',
  'Callers speak English, Swahili or Sheng. Dates are in Africa/Nairobi.',
].join(' ');
function buildModelRequest({ text, snap, facts, history = [], allowed, tools, now = new Date() }) {
  const ctx = { now_eat: new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), state: { phase: snap.phase, intent: snap.intent, expecting: snap.expecting, lang: snap.lang, slots: snap.slots, read_back_waiting: snap.phase === 'readback' ? snap.pendingTool : null, confirm_token: snap.phase === 'readback' ? snap.pendingToken : null }, facts: factsBlock(facts) };
  const decl = toFunctionDeclarations(Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, { description: v.description, parameters: v.parameters }])), allowed);
  return {
    systemInstruction: { parts: [{ text: `${SYSTEM}\nCONTEXT ${JSON.stringify(ctx)}` }] },
    contents: [...history, { role: 'user', parts: [{ text: redact(text) }] }],
    tools: decl.length ? [{ functionDeclarations: decl }] : undefined,
    toolConfig: { functionCallingConfig: { mode: decl.length ? 'AUTO' : 'NONE' } },
    generationConfig: { temperature: 0.1, maxOutputTokens: 160, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
  };
}

// ---------- the rules' reading of the same turn (from the machine, after the turn) ----------
const RULE_OF_PENDING = { create_booking: 'book', create_order: 'order', create_handoff: 'callback', cancel_booking: 'cancel', update_booking: 'change', log_complaint: 'callback' };
const INFO_INTENT = { price: 'price', hours: 'hours', availability: 'availability', coverage: 'availability', recall: 'recall' };
function rulesView(before, after, done = {}) {
  let intent = 'none';
  const asked = Object.keys(after.infoRepeat || {}).find((k) => (after.infoRepeat[k] || 0) > (before.infoRepeat?.[k] || 0));
  if (done.end || (after.ended && !before.ended)) intent = 'end';
  else if (after.pendingTool && (after.phase === 'readback')) intent = RULE_OF_PENDING[after.pendingTool] || after.pendingTool;
  else if ((done.toolResults || []).length && before.pendingTool) intent = RULE_OF_PENDING[before.pendingTool] || 'none'; // the yes that committed the read-back
  else if (asked && INFO_INTENT[asked]) intent = INFO_INTENT[asked];
  else if (after.intent) intent = RULE_OF_PENDING[`create_${after.intent}`] || after.intent;
  return { intent, slots: after.slots };
}
function proposalView(call, facts) {
  if (!call) return { intent: 'none', slots: {} };
  const a = call.args || {};
  const svc = a.service_id ? (facts.services || []).find((s) => s.id === a.service_id) : null;
  return { intent: (buildTools(facts)[call.name] || {}).intent || 'none', slots: { service: svc ? (svc.row?.name || svc.name) : null, date: a.when?.date || a.pickup?.date || null, time: a.when?.time || a.pickup?.time || null, items: Array.isArray(a.items) ? a.items.map((x) => ({ product_id: x.product_id, name: ((facts.products || []).find((p) => p.id === x.product_id) || {}).name || null, qty: x.qty })) : [] } };
}
const OTHER = new Set(['none', 'services', 'faq', 'explain', 'greeting', 'want_know', 'who_are_you', 'payment_how', 'policy_returns', 'policy_deposit', 'policy_warranty', 'policy_cancel']);
function agreement(rules, model) {
  const ri = OTHER.has(rules.intent) ? 'none' : rules.intent;
  const intentAgree = ri === model.intent;
  const diffs = [];
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const k of ['service', 'date', 'time']) if (rules.slots?.[k] && model.slots?.[k] && norm(rules.slots[k]) !== norm(model.slots[k])) diffs.push(k);
  const key = (x) => norm(x.name || x.product_id);
  const ri2 = (rules.slots?.items || []).map(key).sort().join(','); const mi2 = (model.slots?.items || []).map(key).sort().join(',');
  if (ri2 && mi2 && ri2 !== mi2) diffs.push('items');
  return { agree: intentAgree && !diffs.length, intentAgree, slotDiffs: diffs };
}

function usageOf(u = {}, request) {
  const has = u && (u.promptTokenCount != null || u.candidatesTokenCount != null);
  const inTok = has ? Number(u.promptTokenCount || 0) : Math.ceil(JSON.stringify(request || {}).length / 4);
  const cached = has ? Number(u.cachedContentTokenCount || 0) : 0;
  const out = has ? Number(u.candidatesTokenCount || 0) : 0;
  const thoughts = has ? Number(u.thoughtsTokenCount || 0) : 0;
  const usd = (inTok - cached) * PRICE.inUsd + cached * PRICE.cachedUsd + (out + thoughts) * PRICE.outUsd;
  return { in: inTok, cached, out, thoughts, estimated: !has, costUsd: Number(usd.toFixed(7)), costKes: Number((usd * PRICE.kesPerUsd).toFixed(5)) };
}

// Runs a model call under the hard cap. Never throws: errors and timeouts are results.
async function capped(model, request, capMs = HARD_CAP_MS) {
  const t0 = Date.now(); const ac = new AbortController(); let timer;
  const cap = new Promise((resolve) => { timer = setTimeout(() => { ac.abort(); resolve({ timedOut: true }); }, capMs); });
  let out;
  try { out = await Promise.race([Promise.resolve().then(() => model({ request, signal: ac.signal })).then((r) => ({ r }), (e) => ({ error: String(e?.code || e?.status || 'error').slice(0, 40) })), cap]); } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  if (out.timedOut) return { timedOut: true, latencyMs: ms, calls: [], usage: null };
  if (out.error) return { error: out.error, latencyMs: ms, calls: [], usage: null };
  const r = out.r || {};
  return { latencyMs: ms, calls: Array.isArray(r.calls) ? r.calls : [], usage: r.usage || null, text: r.text ? '[model text dropped]' : '' };
}

// One overall hard cap for primary+backup (not 2× cap). Stop the old 550/350 starve:
// primary gets the wall minus only MIN_BACKUP so warm ~843ms primary can finish;
// backup then runs on remaining wall. Transport only — model plaintext still dropped.
// Never throws. Pattern spirit of geminiVoice.nextGeminiStreamAttempt, Brain-owned here.
// BACKUP_RESERVE_MS kept exported (= MIN_BACKUP) so old harness imports don't break;
// it is NOT subtracted as a large upfront reserve anymore.
const MIN_BACKUP_MS = 250;
const BACKUP_RESERVE_MS = MIN_BACKUP_MS;
// Timer slack so primary abort + scheduling does not eat the whole backup floor.
const CASCADE_SLACK_MS = 80;
async function cappedCascade({ primary, backup = null, request, capMs = HARD_CAP_MS, primaryId = MODEL_ID, backupId = MODEL_BACKUP_ID } = {}) {
  const t0 = Date.now();
  const canBackup = typeof backup === 'function' && backup !== primary && primaryId !== backupId;
  // Primary gets nearly the full wall; reserve MIN_BACKUP + slack so backup can still run.
  const primaryBudget = canBackup
    ? Math.max(capMs - MIN_BACKUP_MS - CASCADE_SLACK_MS, MIN_BACKUP_MS)
    : capMs;
  const first = await capped(primary, request, primaryBudget);
  const primaryFailed = !!first.timedOut || !!first.error;
  if (!primaryFailed) {
    return {
      ...first,
      model: primaryId,
      answeredBy: 'primary',
      cascade: false,
      primaryTimedOut: false,
      backupTimedOut: false,
      primaryError: null,
    };
  }
  if (!canBackup) {
    return {
      ...first,
      model: primaryId,
      answeredBy: 'primary',
      cascade: false,
      primaryTimedOut: !!first.timedOut,
      backupTimedOut: false,
      primaryError: first.error || null,
    };
  }
  const remaining = capMs - (Date.now() - t0);
  // Attempt backup whenever any meaningful wall remains (not only full MIN_BACKUP).
  if (remaining < 80) {
    return {
      ...first,
      model: primaryId,
      answeredBy: 'none',
      cascade: false,
      primaryTimedOut: !!first.timedOut,
      backupTimedOut: false,
      primaryError: first.error || null,
      backupSkipped: 'budget',
      latencyMs: Date.now() - t0,
      timedOut: true,
    };
  }
  const second = await capped(backup, request, remaining);
  const backupOk = !second.timedOut && !second.error && Array.isArray(second.calls);
  // Honesty: both fail / null proposal → answeredBy=none (never claim backup success).
  if (!backupOk || (second.timedOut && !(second.calls && second.calls.length))) {
    return {
      ...second,
      model: backupId,
      answeredBy: 'none',
      cascade: true,
      primaryTimedOut: !!first.timedOut,
      backupTimedOut: !!second.timedOut,
      primaryError: first.error || null,
      primaryLatencyMs: first.latencyMs,
      latencyMs: Date.now() - t0,
      timedOut: true,
      calls: [],
    };
  }
  return {
    ...second,
    model: backupId,
    answeredBy: 'backup',
    cascade: true,
    primaryTimedOut: !!first.timedOut,
    backupTimedOut: !!second.timedOut,
    primaryError: first.error || null,
    primaryLatencyMs: first.latencyMs,
    latencyMs: Date.now() - t0,
  };
}

// One runner per call: keeps the model's own history (with thoughtSignature passed back).
function createModelShadow({ model, backupModel = null, mode = 'shadow', onStage = () => {}, log = () => {}, now = () => new Date(), modelId = MODEL_ID, backupModelId = MODEL_BACKUP_ID } = {}) {
  const history = [];
  let turns = 0; let agreeN = 0;
  function remember(text, call, result) {
    history.push({ role: 'user', parts: [{ text: redact(text) }] });
    if (call) {
      const part = { functionCall: { name: call.name, args: redactDeep(call.args || {}) } };
      if (call.thoughtSignature) part.thoughtSignature = String(call.thoughtSignature);
      history.push({ role: 'model', parts: [part] });
      history.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: result } }] });
    }
    while (history.filter((h) => h.role === 'user' && h.parts[0]?.text != null).length > HISTORY_TURNS) {
      history.shift(); while (history.length && !(history[0].role === 'user' && history[0].parts[0]?.text != null)) history.shift();
    }
  }
  // begin: before the rules turn mutates state. Returns finish(after, done) -> Promise<stage>.
  function begin({ text, state, profile = {}, turnIndex = null, openRows = [] }) {
    const snap = snapshot(state); // the only synchronous work on the caller's turn
    const hist = history.slice(); const at = now();
    let facts; let tools; let allowed; let request;
    // facts, request and the model call start on the next tick, so the rules turn is never delayed
    const pending = new Promise((resolve) => setImmediate(resolve)).then(() => {
      facts = FS.factsFor(profile); tools = buildTools(facts, { openRows }); allowed = allowedTools(snap);
      request = buildModelRequest({ text, snap, facts, history: hist, allowed, tools, now: at });
      return model
        ? cappedCascade({ primary: model, backup: backupModel, request, primaryId: modelId, backupId: backupModelId })
        : { error: 'no_model', latencyMs: 0, calls: [], model: modelId, cascade: false, primaryTimedOut: false, backupTimedOut: false };
    });
    return function finish(after, done) {
      const rules = rulesView(snap, snapshot(after), done || {});
      return pending.then((m) => {
        const call = m.calls[0] || null;
        const check = call ? validateProposal(call, { tools, facts, snap, allowed }) : null;
        const result = check ? (check.ok ? { ok: true, ...(check.commit ? { commit: true } : { status: 'proposed' }) } : { ok: false, error: check.error }) : null;
        remember(text, call, result);
        const prop = proposalView(check && check.ok ? call : null, facts);
        const ag = m.timedOut || m.error ? { agree: false, intentAgree: false, slotDiffs: [] } : agreement(rules, prop);
        turns += 1; if (ag.agree) agreeN += 1;
        const answered = m.model || modelId;
        // Honesty: pass through none|both_timeout|primary|backup — never invent backup success.
        const answeredBy = (m.answeredBy === 'backup' || m.answeredBy === 'primary' || m.answeredBy === 'none' || m.answeredBy === 'both_timeout')
          ? m.answeredBy
          : (m.timedOut || m.error ? 'none' : 'primary');
        const stage = {
          stage: 'brain_v2_model', mode, model: answered, answeredBy, turnIndex,
          allowed, rules: { intent: rules.intent, slots: redactDeep(rules.slots) },
          proposal: call ? { tool: call.name, args: redactDeep(call.args || {}), valid: !!check?.ok, error: check && !check.ok ? check.error : null, commit: !!check?.commit, extraCalls: Math.max(0, m.calls.length - 1) } : null,
          modelIntent: prop.intent, agree: ag.agree, intentAgree: ag.intentAgree, slotDiffs: ag.slotDiffs,
          latencyMs: m.latencyMs, timedOut: !!m.timedOut, error: m.error || null, capMs: HARD_CAP_MS,
          cascade: !!m.cascade, primaryTimedOut: !!m.primaryTimedOut, backupTimedOut: !!m.backupTimedOut,
          primaryError: m.primaryError || null,
          tokens: m.timedOut || m.error ? usageOf(null, request) : usageOf(m.usage, request),
          thoughtSignature: !!call?.thoughtSignature,
        };
        try { onStage(stage); } catch (e) { log(`[brain_v2_model] trace failed: ${e?.message || e}`); }
        log(`[brain_v2_model] ${mode} turn=${turnIndex} rules=${rules.intent} model=${prop.intent}${call && !check?.ok ? `(${check.error})` : ''} agree=${ag.agree} ms=${m.latencyMs}${m.timedOut ? ' timeout' : ''}${m.cascade ? ' cascade' : ''}${m.error ? ` error=${m.error}` : ''} via=${answeredBy}:${answered}`);
        return stage;
      }).catch((e) => { log(`[brain_v2_model] shadow failed: ${String(e?.message || e).slice(0, 80)}`); return null; });
    };
  }
  return { begin, history, stats: () => ({ turns, agree: agreeN }) };
}

function scoreCascadeStages(stages = []) {
  // B2: with cascade enabled, fail if every turn timed out on primary only with zero backup attempts.
  const rows = (Array.isArray(stages) ? stages : []).filter((s) => s && s.stage === 'brain_v2_model');
  if (!rows.length) return { pass: true, reason: 'no_stages', n: 0, backupAttempts: 0 };
  const backupAttempts = rows.filter((s) => s.cascade === true || s.answeredBy === 'backup').length;
  const allPrimaryTimeoutNoBackup = rows.every((s) => s.timedOut === true && s.cascade !== true && s.answeredBy !== 'backup');
  if (allPrimaryTimeoutNoBackup) {
    return { pass: false, reason: 'primary_only_timeouts_no_backup', n: rows.length, backupAttempts: 0 };
  }
  return { pass: true, reason: 'ok', n: rows.length, backupAttempts };
}

module.exports = { HARD_CAP_MS, BACKUP_RESERVE_MS, MIN_BACKUP_MS, CASCADE_SLACK_MS, MODEL_ID, MODEL_BACKUP_ID, PRICE, modelMode, resolveModelIds, buildTools, allowedTools, validateProposal, buildModelRequest, snapshot, rulesView, proposalView, agreement, usageOf, capped, cappedCascade, createModelShadow, scoreCascadeStages, redact };
