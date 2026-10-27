'use strict';
// One model call per turn (brain/turn-resolver-v1-model-call). The model only fills the
// TurnAsk set (place / service id / asks) through ONE extraction function; it never speaks
// and never carries a fact (no prices, notes or explain text are sent). The system resolves.
//  - started on a stable partial (Voice's unfinished hold) or on the final, whichever comes first
//  - a new, different text cancels the stale call (AbortController); nothing leaks into the next turn
//  - v1 failure policy (v1 geminiVoice.js:251-266): timeout/error -> retry the same model once after
//    400 ms; 503/429 on the retry -> the backup; stop otherwise. All inside HARD_CAP_MS (not raised).
//  - process-wide warm stream client per (key, model); prewarm at call start
//  - static prefix (system + tool + entity vocabulary) memoised per tenant so it is byte-identical
//    turn to turn (Gemini implicit prefix cache); short history + a per-turn fact note
//  - exactly one trace stage per turn: the call the reply used (used:true) or why none was used
const { HARD_CAP_MS, MODEL_ID, MODEL_BACKUP_ID } = require('./modelShadow');

const RETRY_WAIT_MS = 400;
const MIN_ATTEMPT_MS = 250;
const HISTORY_TURNS = 4;
// BRAIN_V2_REPLY_OWNER adds 'check_or_correct_detail' ("what name did you put?", "carpet cleaning, right?"); off = same bytes as before
const ASK_ENUM = ['explain', 'price', 'possible', 'book', 'coverage', 'hours', 'services', ...(process.env.BRAIN_V2_REPLY_OWNER === 'on' ? ['check_or_correct_detail'] : []), 'other'];

function classify(err) {
  const s = Number(err && err.status);
  const code = String((err && err.code) || '');
  if (code === 'TIMEOUT' || /timeout/i.test(String(err && err.message))) return 'timeout';
  if (s === 503 || code === 'http_503') return 'unavailable';
  if (s === 429 || code === 'http_429') return 'rate_limit';
  if (s === 401 || s === 403 || s === 402) return 'hard';
  return 'error';
}
/** v1 policy, verbatim shape: { action: 'retry'|'backup'|'stop', model, waitMs }. */
function nextAttempt({ err, attempt = 0, primary = MODEL_ID, backup = MODEL_BACKUP_ID } = {}) {
  const kind = classify(err);
  if (kind === 'hard') return { action: 'stop', model: primary, waitMs: 0 };
  const busy = kind === 'unavailable' || kind === 'rate_limit';
  if (attempt === 0) return { action: 'retry', model: primary, waitMs: RETRY_WAIT_MS };
  if (attempt === 1 && busy && backup && backup !== primary) return { action: 'backup', model: backup, waitMs: 0 };
  return { action: 'stop', model: primary, waitMs: 0 };
}

// ---------- request ----------
const SYSTEM = [
  'You are the listening layer of a phone receptionist for one Kenyan business. You never speak: the server answers from its own facts.',
  'Call note_turn exactly once with what the caller said in this turn: every ask they made, the place they named (their words), and the service id they mean.',
  'Use only service ids from the list. Never add facts. Callers speak English, Swahili or Sheng.',
].join(' ');
const PREFIX = new Map(); // tenant key -> { systemInstruction, tools, toolConfig } (same object = same bytes)
function staticPrefix(profile = {}) {
  const services = (profile.servicesCatalog || []).slice(0, 60).map((s) => ({ id: s.id, name: s.name }));
  const key = `${profile.id || profile.tenantId || ''}|${services.map((s) => s.id).join(',')}`;
  if (PREFIX.has(key)) return PREFIX.get(key);
  const ids = services.length ? services.map((s) => s.id) : ['__none__'];
  const vocab = `Services (id: name): ${services.map((s) => `${s.id}: ${s.name}`).join('; ') || 'none'}.`;
  const p = {
    systemInstruction: { parts: [{ text: `${SYSTEM}\n${vocab}` }] },
    tools: [{ functionDeclarations: [{
      name: 'note_turn',
      description: 'What the caller asked this turn. Fields you are not sure of are left out.',
      parameters: { type: 'object', properties: {
        asks: { type: 'array', items: { type: 'string', enum: ASK_ENUM } },
        place: { type: 'string', description: 'A place the caller named, in their words.' },
        service_id: { type: 'string', enum: ids },
      } },
    }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['note_turn'] } },
    generationConfig: { temperature: 0, maxOutputTokens: 96, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
  };
  PREFIX.set(key, p);
  return p;
}
function buildTurnRequest({ text, profile, history = [], note = '' }) {
  const p = staticPrefix(profile);
  const contents = history.slice(-HISTORY_TURNS).map((h) => ({ role: 'user', parts: [{ text: String(h).slice(0, 240) }] }));
  contents.push({ role: 'user', parts: [{ text: `${note ? `[${note}]\n` : ''}${String(text || '')}` }] });
  return { ...p, contents };
}
function fieldsOf(call) {
  if (!call || call.name !== 'note_turn') return null;
  const a = call.args || {};
  return {
    asks: (Array.isArray(a.asks) ? a.asks : []).filter((x) => ASK_ENUM.includes(x)),
    place: typeof a.place === 'string' && a.place.trim() ? a.place.trim().slice(0, 60) : null,
    service_id: typeof a.service_id === 'string' && a.service_id !== '__none__' ? a.service_id : null,
  };
}
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * streamFor(modelId) -> async ({ request, signal, onCall }) => { calls, usage }
 */
function createTurnModel({ streamFor, primaryId = MODEL_ID, backupId = MODEL_BACKUP_ID, capMs = HARD_CAP_MS, minAttemptMs = MIN_ATTEMPT_MS, onStage = () => {}, log = () => {}, clock = () => Date.now(), sleep } = {}) {
  const wait = sleep || ((ms, signal) => new Promise((res) => { const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); }));
  let live = null; // the one in-flight call
  let seq = 0;
  let requests = 0; // model HTTP requests issued for the current turn
  let cancelled = 0;
  const history = [];

  function cancel(reason = 'stale') {
    if (live && !live.settled) { live.ac.abort(); live.cancelReason = reason; cancelled += 1; }
    live = null;
  }
  function start({ text, profile, note = '', startedOn = 'final' }) {
    const id = `tm_${++seq}`;
    const ac = new AbortController();
    const t0 = clock();
    const request = buildTurnRequest({ text, profile, history, note });
    const c = { id, text, key: norm(text), ac, t0, startedOn, attempts: [], fields: null, usage: null, settled: false, request, firstFieldMs: null };
    let resolveFirst; c.first = new Promise((r) => { resolveFirst = r; });
    c.done = (async () => {
      let model = primaryId;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const left = capMs - (clock() - t0);
        if (left < minAttemptMs || ac.signal.aborted) break;
        const a0 = clock(); const legAc = new AbortController();
        const onAbort = () => legAc.abort(); ac.signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => legAc.abort(), left);
        requests += 1;
        try {
          const out = await streamFor(model)({ request, signal: legAc.signal, onCall: (call) => { const f = fieldsOf(call); if (f && !c.fields) { c.fields = f; c.firstFieldMs = clock() - t0; resolveFirst(c); } } });
          const f = fieldsOf((out?.calls || []).find((x) => x.name === 'note_turn'));
          if (f && !c.fields) { c.fields = f; c.firstFieldMs = clock() - t0; }
          c.usage = out?.usage || null;
          c.attempts.push({ model, ms: clock() - a0, outcome: c.fields ? 'ok' : 'empty' });
          break;
        } catch (e) {
          const err = legAc.signal.aborted && !ac.signal.aborted ? Object.assign(new Error('gemini timeout'), { code: 'TIMEOUT' }) : e;
          if (ac.signal.aborted) { c.attempts.push({ model, ms: clock() - a0, outcome: 'cancelled' }); break; }
          const kind = classify(err);
          c.attempts.push({ model, ms: clock() - a0, outcome: kind });
          const next = nextAttempt({ err, attempt, primary: primaryId, backup: backupId });
          if (next.action === 'stop') break;
          if (next.waitMs) await wait(next.waitMs, ac.signal);
          model = next.model;
        } finally { clearTimeout(timer); ac.signal.removeEventListener('abort', onAbort); }
      }
      c.settled = true; c.latencyMs = clock() - t0; resolveFirst(c);
      return c;
    })();
    return c;
  }

  /** A stable partial: start (or keep) the turn's one call early. */
  function partial({ text, profile, note }) {
    if (!String(text || '').trim()) return null;
    if (live && live.key === norm(text)) return live;
    if (live && !live.settled) cancel('stale_partial');
    live = start({ text, profile, note, startedOn: 'partial' });
    return live;
  }

  /**
   * The final: reuse the in-flight call when it heard the same words; otherwise cancel it and start
   * one for the final. Waits until the first complete fields or budgetMs, whichever is first.
   * Fields from a stale partial call are never used (they were about other words).
   */
  async function forFinal({ text, profile, note, budgetMs, turnIndex = null }) {
    const reused = !!(live && live.key === norm(text));
    if (!reused) { if (live) cancel('stale_final'); live = start({ text, profile, note, startedOn: 'final' }); }
    const c = live;
    const t = clock();
    const capLeft = Math.max(0, capMs - (t - c.t0));
    const budget = Math.min(budgetMs == null ? capLeft : budgetMs, capLeft);
    let timer;
    await Promise.race([c.first, new Promise((r) => { timer = setTimeout(r, budget); })]);
    clearTimeout(timer);
    const used = !!c.fields;
    const stage = {
      stage: 'brain_v2_model', mode: 'on', path: 'turn_model', callId: c.id, turnIndex,
      used, usedBy: used ? 'resolver' : null, startedOn: c.startedOn, reusedPartial: reused,
      waitedMs: clock() - t, firstFieldMs: c.firstFieldMs, latencyMs: c.settled ? c.latencyMs : null,
      attempts: c.attempts.slice(), requestsThisTurn: requests, cancelledStale: cancelled,
      answeredBy: used ? (c.attempts.find((a) => a.outcome === 'ok')?.model === backupId ? 'backup' : 'primary') : 'none',
      timedOut: !used, capMs,
      fields: used ? { asks: c.fields.asks, place: c.fields.place ? 'set' : null, service_id: c.fields.service_id } : null,
      tokens: c.usage ? { in: c.usage.promptTokenCount || 0, cached: c.usage.cachedContentTokenCount || 0, out: c.usage.candidatesTokenCount || 0 } : null,
    };
    // the reply is decided now: nothing from this call can change it any more
    if (!c.settled) { c.ac.abort(); c.cancelReason = 'reply_decided'; }
    live = null; requests = 0; cancelled = 0;
    history.push(text); if (history.length > HISTORY_TURNS) history.shift();
    try { onStage(stage); } catch (e) { log(`[brain_v2_model] trace failed: ${e?.message || e}`); }
    log(`[brain_v2_model] turn_model used=${used} started=${c.startedOn} reused=${reused} first=${c.firstFieldMs}ms attempts=${c.attempts.map((a) => `${a.model}:${a.outcome}`).join(',')}`);
    return { fields: used ? c.fields : null, stage };
  }
  return { partial, forFinal, cancel, inFlight: () => live, history };
}

// ---------- process-wide warm client ----------
const STREAMS = new Map();
function warmStreamFor({ apiKey, create, fetchImpl = globalThis.fetch, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' }) {
  return (modelId) => {
    const k = `${modelId}`;
    if (!STREAMS.has(k)) STREAMS.set(k, create({ apiKey, model: modelId, fetchImpl, baseUrl }));
    return STREAMS.get(k);
  };
}
const WARMED = new Map();
/** Open the TLS connection at call start (keep-alive pool) with a metadata GET; key only in the header. */
function prewarm({ apiKey, modelId = MODEL_ID, fetchImpl = globalThis.fetch, baseUrl = 'https://generativelanguage.googleapis.com/v1beta', now = Date.now() } = {}) {
  if (!apiKey || typeof fetchImpl !== 'function') return Promise.resolve(false);
  const last = WARMED.get(modelId) || 0;
  if (now - last < 30000) return Promise.resolve(true);
  WARMED.set(modelId, now);
  return Promise.resolve(fetchImpl(`${baseUrl}/models/${encodeURIComponent(modelId)}`, { method: 'GET', headers: { 'x-goog-api-key': apiKey } })).then(() => true, () => false);
}

// ---------- per-call registry (Voice's unfinished hold reaches the same instance as the final) ----------
const CALLS = new Map();
function forCall(callKey, make) {
  if (!callKey) return make();
  if (!CALLS.has(callKey)) CALLS.set(callKey, make());
  return CALLS.get(callKey);
}
function endCall(callKey) { const tm = CALLS.get(callKey); if (tm) tm.cancel('call_end'); CALLS.delete(callKey); }

module.exports = { RETRY_WAIT_MS, HISTORY_TURNS, ASK_ENUM, nextAttempt, classify, staticPrefix, buildTurnRequest, fieldsOf, createTurnModel, warmStreamFor, prewarm, forCall, endCall, _calls: CALLS };
