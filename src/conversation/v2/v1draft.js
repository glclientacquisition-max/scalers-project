'use strict';
// BRAIN_V1_DRAFT (off | shadow | on; default off; Done & Dusted only).
// Design: ship-briefs/2026-10-24_brain_v1-draft-kb-verify-design.md (Alvin GO 10:57, answers 11:19-11:20 EAT).
// v1's model drafts the reply; every sentence is verified against the KB fact note before TTS
// (v1draftVerify.js); v2 (reply owner #925 + conv state #924) answers only when every model failed.
//  - one streaming call per turn (v1 server.js:7184), warm process-wide client (v1 server.js:628 /
//    TM.prewarm), v1 failure policy (main geminiVoice.js:252-266 nextGeminiStreamAttempt, via TM.nextAttempt):
//    timeout/error -> retry the same model after 400 ms; 503/429 on the retry -> backup; else stop.
//  - structured output only: native function calls say{text,refs,kind} / note_asks / propose_*.
//    Model prose outside say() is never spoken. Tool proposals never write: v2 runs the booking /
//    callback flow, and only a backend write id confirms anything (v1 geminiVoice.js:286 rule).
//  - availability is never stated by the model: only the booking flow checks slots (Alvin 11:20).
const TM = require('./turnModel');
const MS = require('./modelShadow');
const RO = require('./replyOwner');
const CONV = require('./convState');
const { buildFactNote } = require('./v1draftFacts');
const { verifySentence, unknownLine } = require('./v1draftVerify');
const { spoken: spokenStyle } = require('./spokenStyle');

const DND_TENANT = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0'; // Done & Dusted (default scope)
const MODES = new Set(['off', 'shadow', 'on']);
function mode({ env = process.env, tenantId } = {}) {
  const m = String(env.BRAIN_V1_DRAFT || 'off').trim().toLowerCase();
  if (!MODES.has(m) || m === 'off') return 'off';
  const allow = String(env.BRAIN_V1_DRAFT_TENANTS || DND_TENANT).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (tenantId == null || !allow.includes(String(tenantId).trim().toLowerCase())) return 'off';
  return m;
}

// BRAIN_V1_DRAFT_PHASE_A=on (only with BRAIN_V1_DRAFT=on, same tenant scope): one shared understanding
// per turn, handoff carries the draft's slots + asks, no repeated greeting, one spoken number style.
// voice-qa/2026-10-24_926-dials-two-systems.md §3 Phase A.
function phaseA({ env = process.env, tenantId } = {}) {
  return mode({ env, tenantId }) === 'on' && String(env.BRAIN_V1_DRAFT_PHASE_A || 'off').trim().toLowerCase() === 'on';
}
// [PROMPT-PLACEHOLDER] copy for the wait / hello-after-wait acts and the no-repeat greeting swap.
const PHASE_A_LINES = {
  wait: { en: 'Sure, take your time.', sw: 'Sawa, chukua muda wako.' },
  afterWait: { en: "I'm here. What would you like to change?", sw: 'Niko hapa. Ungependa kubadilisha nini?' },
  goAhead: { en: 'Sure, go ahead.', sw: 'Sawa, endelea.' },
};
const phaseALine = (key, lang) => (PHASE_A_LINES[key] || {})[/^sw/.test(String(lang || '')) ? 'sw' : 'en'] || null;
const GREET_ASK = /\b(how (can|may) i help|what can i do for you|nikusaidie|naweza kukusaidia)\b/i;

// Ladder deadlines, ms from the turn start (caller stop). Design §3.
const DEADLINES = { r1FirstMs: 1400, r2FirstByMs: 2600, r3FirstByMs: 3000, wallMs: 6000, fillerMs: 900 };
const HISTORY = 8;
const ASKS = ['place', 'service', 'explain', 'price', 'possible', 'book', 'callback', 'hours', 'pay', 'coverage', 'check_or_correct_detail', 'other'];

// [PROMPT-PLACEHOLDER] system copy (Prompt owns tone); the rules below are the contract the verifier enforces.
const RULES = [
  'You are the voice receptionist for one Kenyan business on a phone call. You speak only through the say function, one sentence per call, at most 3 sentences, each under 25 words.',
  'First call note_asks with every thing the caller asked this turn. Then answer every ask, then ask at most one question.',
  'Facts (prices, areas, hours, payment, services and what they include, the caller name) may come ONLY from the FACTS list. Put the ids you used in refs, e.g. ["P13"]. Never state a fact that is not listed; if it is missing, say you do not have that detail, with no refs.',
  'Never say a time slot or day is available or free. Never say anything is booked, confirmed or that someone will call: for a booking call propose_booking; for a callback request call propose_callback.',
  'Use digits for numbers. Reply in the language given as reply_lang (en = English, sw = Swahili). Do not greet again.',
].join('\n');
const PREFIX = new Map();
function staticPrefix(profile, note) {
  const stable = note.facts.filter((f) => /^(S|P|A\d|H|M|B)/.test(f.id)).map((f) => `[${f.id}] ${f.text}`).join('\n');
  const key = `${profile.id || profile.tenantId || ''}|${stable.length}|${stable.slice(0, 64)}`;
  if (PREFIX.has(key)) return PREFIX.get(key);
  const p = {
    systemInstruction: { parts: [{ text: `${RULES}\nFACTS:\n${stable}` }] },
    tools: [{ functionDeclarations: [
      { name: 'note_asks', description: 'Everything the caller asked or did this turn.', parameters: { type: 'object', properties: { asks: { type: 'array', items: { type: 'string', enum: ASKS } }, service_ids: { type: 'array', items: { type: 'string' } }, place: { type: 'string' } }, required: ['asks'] } },
      { name: 'say', description: 'One sentence to speak, with the fact ids it uses.', parameters: { type: 'object', properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['fact', 'social', 'question'] } }, required: ['text', 'refs', 'kind'] } },
      { name: 'propose_booking', description: 'The caller wants to book a service.', parameters: { type: 'object', properties: { service_id: { type: 'string' } } } },
      { name: 'propose_callback', description: 'The caller asked for a call back.', parameters: { type: 'object', properties: { reason: { type: 'string' } } } },
    ] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY' } },
    generationConfig: { temperature: 0.3, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
  };
  if (PREFIX.size > 200) PREFIX.clear();
  PREFIX.set(key, p);
  return p;
}
function snapshot(state) {
  const c = state.conv || {};
  return JSON.stringify({ service: c.service?.name || state.slots?.service || null, open_offer: state.offer || c.offer?.type || null, callback: c.callback?.status || 'none', area: state.slots?.place || null, booking_in_progress: !!state.intent, expecting: state.expecting || null });
}
function buildRequest({ text, profile, state, note, replyLang, stepNote = null }) {
  const p = staticPrefix(profile, note);
  const dyn = note.facts.filter((f) => !/^(S|P|A\d|H|M|B)/.test(f.id)).map((f) => `[${f.id}] ${f.text}`).join('\n');
  const hist = (state.v1History || []).slice(-HISTORY).map((h) => ({ role: h.role === 'caller' ? 'user' : 'model', parts: [{ text: h.text }] }));
  const user = `${dyn ? `TURN FACTS:\n${dyn}\n` : ''}STATE: ${snapshot(state)}\n${stepNote ? `${stepNote}\n` : ''}reply_lang: ${replyLang}\nCALLER: ${text}`;
  return { ...p, contents: [...hist, { role: 'user', parts: [{ text: user }] }] };
}
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const QUESTION = /\?|\b(how|what|where|when|which|why|who|do you|does|can you|is it|are you|bei|ngapi|wapi|aje|gani|je|mnafanya|mnafika)\b/i;

/** v2 keeps the turn while an action flow is open (read-back, collecting a booking, a yes/no to its offer). */
function v2OwnsTurn(state, text) {
  if (state.phase === 'readback' || state.pending) return 'readback';
  if ((state.intent || state.expecting) && !QUESTION.test(String(text || ''))) return 'action_flow';
  if (state.offer && !QUESTION.test(String(text || ''))) return 'offer_answer';
  return null;
}

/**
 * One streamed attempt ladder. Events: { type:'say'|'asks'|'proposal', ... } through onEvent, in order.
 * Returns { attempts:[{model, ok, err, firstMs}], used: model|null, spoke: bool }.
 */
async function ladder({ streamFor, primaryId, backupId, request, onEvent, signal, t0, clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), deadlines = DEADLINES }) {
  const attempts = []; let gotSay = false;
  const firstBy = [deadlines.r1FirstMs, deadlines.r2FirstByMs, deadlines.r3FirstByMs];
  let model = primaryId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) break;
    const ac = new AbortController(); const stop = () => ac.abort(); signal?.addEventListener?.('abort', stop, { once: true });
    const left = firstBy[attempt] - (clock() - t0);
    if (left <= 50) { attempts.push({ model, ok: false, err: 'no_budget' }); break; }
    let first = null; let timedOut = false;
    const firstTimer = setTimeout(() => { if (first == null) { timedOut = true; ac.abort(); } }, left);
    const wall = setTimeout(() => { timedOut = true; ac.abort(); }, Math.max(left, deadlines.wallMs - (clock() - t0)));
    try {
      await streamFor(model)({ request, signal: ac.signal, onCall: (c) => {
        if (first == null) { first = clock() - t0; clearTimeout(firstTimer); }
        if (c.name === 'say') gotSay = true;
        onEvent(c, { model, attempt });
      } });
      attempts.push({ model, ok: true, firstMs: first });
      return { attempts, used: model, spoke: gotSay };
    } catch (e) {
      const err = timedOut && !signal?.aborted ? Object.assign(new Error('gemini timeout'), { code: 'TIMEOUT' }) : e;
      attempts.push({ model, ok: false, err: String(err?.code || err?.message || err).slice(0, 40), firstMs: first });
      if (signal?.aborted || gotSay) return { attempts, used: gotSay ? model : null, spoke: gotSay, broken: gotSay }; // never restart after speech
      const next = TM.nextAttempt({ err, attempt: Math.min(attempt, 1), primary: primaryId, backup: backupId });
      if (attempt >= 1 && next.action !== 'backup') break;
      if (next.action === 'stop') break;
      if (next.waitMs) await sleep(next.waitMs);
      model = next.model;
    } finally { clearTimeout(firstTimer); clearTimeout(wall); signal?.removeEventListener?.('abort', stop); }
  }
  return { attempts, used: null, spoke: false };
}

/** Per-call drafter. streamFor(modelId) -> streamModel({request, signal, onCall}). */
function createV1Draft({ streamFor, primaryId = MS.MODEL_ID, backupId = MS.MODEL_BACKUP_ID, onStage = () => {}, log = () => {}, clock = Date.now, sleep, deadlines = DEADLINES } = {}) {
  let early = null; // { key, events:[], done:Promise, ac, listeners:Set }
  function launch({ text, profile, state, langLock, startedOn, stepNote = null }) {
    const replyLang = langOf(state, langLock, text);
    const note = buildFactNote(profile, state, { callerText: text, writes: writesOf(state) });
    const request = buildRequest({ text, profile, state, note, replyLang, stepNote });
    const ac = new AbortController(); const t0 = clock();
    const run = { key: norm(text), events: [], listeners: new Set(), ac, note, replyLang, t0, startedOn, request };
    run.done = ladder({ streamFor, primaryId, backupId, request, signal: ac.signal, t0, clock, sleep, deadlines, onEvent: (c, meta) => { const ev = { ...c, ...meta, atMs: clock() - t0 }; run.events.push(ev); for (const l of run.listeners) l(ev); } });
    return run;
  }
  function partial({ text, profile, state, langLock }) {
    if (!text || v2OwnsTurn(state, text)) return false;
    if (early && early.key === norm(text)) return true;
    if (early) early.ac.abort();
    early = launch({ text, profile, state, langLock, startedOn: 'partial' });
    return true;
  }
  function cancel() { if (early) { early.ac.abort(); early = null; } }

  /**
   * Draft one turn. Returns { path, line, sentences, verdicts, turnFields, trace }.
   * path: 'v1_draft' (verified sentences spoken) | 'v2_owned:<why>' | 'v2_action' | 'v2_fallback'.
   */
  async function turn({ text, profile = {}, state, langLock = null, onSentence = null, shouldAbort = () => false, turnIndex = null, phaseA: pA = false, plan = null }) {
    // Phase B: no owner switch. v2 already ran this turn's step; the model speaks every turn.
    const owns = plan ? null : v2OwnsTurn(state, text);
    if (owns) { cancel(); return { path: `v2_owned:${owns}`, sentences: [] }; }
    const T = clock();
    let run = early && early.key === norm(text) ? early : null;
    if (plan) { cancel(); run = launch({ text, profile, state, langLock, startedOn: 'final', stepNote: plan.note }); } else if (!run) { cancel(); run = launch({ text, profile, state, langLock, startedOn: 'final' }); }
    early = null;
    const { note, replyLang } = run;
    const c = CONV.conv(state);
    const sentences = []; const verdicts = []; const proposals = []; let asks = null; let replaced = false;
    let cbOffered = c.callback?.status && c.callback.status !== 'none';
    let handoff = false; let firstSentenceMs = null;
    const unlockedNames = state.slots?.name && !state.slots.nameConfirmed ? [state.slots.name] : [];
    // a bare-word caller turn ("Nipo.") is never a name the model may address the caller by
    for (const h of (state.v1History || []).filter((x) => x.role === 'caller').slice(-4)) { const w = String(h.text).replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean); if (w.length === 1 && w[0].length >= 3 && !(state.slots?.nameConfirmed && state.slots.name && state.slots.name.toLowerCase() === w[0].toLowerCase())) unlockedNames.push(w[0]); }
    const consume = (ev) => {
      if (handoff || shouldAbort()) { if (shouldAbort()) run.ac.abort(); return; }
      if (ev.name === 'note_asks') { asks = ev.args || {}; return; }
      if (ev.name === 'propose_booking' || ev.name === 'propose_callback') {
        proposals.push({ name: ev.name, args: ev.args || {} });
        if (!sentences.length && !plan) { handoff = true; run.ac.abort(); }
        return;
      }
      if (ev.name !== 'say') return;
      const a = ev.args || {};
      const v = verifySentence({ text: a.text, refs: a.refs, kind: a.kind, lang: replyLang }, note, { profile, replyLang, unlockedNames });
      const row = { text: String(a.text || '').slice(0, 300), refs: a.refs || [], kind: a.kind || null, verdict: v.verdict, families: v.families, reasons: v.reasons, atMs: ev.atMs, model: ev.model };
      if (v.verdict === 'pass' && pA && GREET_ASK.test(String(a.text)) && (state.v1History || []).some((h) => h.role === 'agent' && GREET_ASK.test(h.text))) {
        // Phase A: the opening already asked how we can help; never a second/third time
        row.verdict = 'replace'; row.reasons = [...(row.reasons || []), 'repeat_greeting'];
        const g = phaseALine('goAhead', replyLang); row.replacement = g; push(g);
      } else if (v.verdict === 'pass') { push(String(a.text).trim()); }
      else if (v.verdict === 'replace' && !replaced) { replaced = true; const u = unknownLine(replyLang, { callbackOffered: cbOffered }); row.replacement = u; if (!cbOffered) { cbOffered = 'offered_now'; } push(u, true); }
      verdicts.push(row);
    };
    const act = { questions: 0, stepSaid: false, gated: [] };
    function push0(s) { if (s && pA) s = spokenStyle(s, replyLang); if (!s || sentences.some((x) => x.text === s)) return; sentences.push({ text: s, lang: replyLang }); if (typeof onSentence === 'function') { try { onSentence({ text: s, lang: replyLang }); } catch { /* speaker hook */ } } }
    function push(s, sys = false) {
      if (s && plan && !sys) {
        const g = plan.check(s, act);
        act.gated.push({ text: String(s).slice(0, 200), verdict: g.verdict, reason: g.reason || null });
        if (g.verdict === 'drop') return;
        if (g.verdict === 'replace') s = g.text;
        if (/\?\s*$/.test(String(s).trim())) { act.questions += 1; act.stepSaid = true; }
      } else if (s && plan && /\?\s*$/.test(String(s).trim())) { act.questions += 1; act.stepSaid = true; }
      if (s && pA) s = spokenStyle(s, replyLang); // Phase A: one spoken style (after the verifier passed the original)
      if (!s || sentences.some((x) => x.text === s)) return;
      if (firstSentenceMs == null) firstSentenceMs = clock() - T;
      sentences.push({ text: s, lang: replyLang });
      if (typeof onSentence === 'function') { try { onSentence({ text: s, lang: replyLang }); } catch { /* speaker hook */ } }
    }
    for (const ev of run.events) consume(ev);
    run.listeners.add(consume);
    const res = await run.done;
    run.listeners.delete(consume);
    if (plan && sentences.length && !act.stepSaid && !shouldAbort()) { const t = plan.tail(); if (t) { act.questions += 1; act.stepSaid = true; push0(t); } }
    try {
      const GH = require('../geminiProviderHealth');
      if (res.used || (handoff && (res.attempts || []).some((x) => x.firstMs != null))) GH.noteBrainModel({ ok: true, model: res.used || (res.attempts || []).find((x) => x.firstMs != null).model });
      else { const bad = (res.attempts || []).find((x) => !x.ok && x.err !== '20' && !/abort/i.test(String(x.err))); if (bad && !handoff) GH.noteBrainModel({ ok: false, model: bad.model, err: bad.err }); }
    } catch { /* health is best effort */ }
    let turnFields = asks ? { asks: (asks.asks || []).filter((x) => ['place', 'explain', 'price', 'possible', 'book'].includes(x)), place: asks.place || null, service_id: (asks.service_ids || [])[0] || null } : null;
    if (pA) turnFields = handoffFields({ asks, proposals, note, profile });
    const trace = { kind: 'v1_draft', turnIndex, startedOn: run.startedOn, replyLang, attempts: res.attempts, used: res.used, broken: !!res.broken, firstSentenceMs, verdicts, proposals, asks, noteIds: note.facts.length, ...(plan ? { phaseB: { step: plan.kind, gated: act.gated, tail: act.stepSaid } } : {}) };
    let path;
    if (sentences.length) {
      path = 'v1_draft';
      // the system's state stays the source of truth: record what was SPOKEN, never the draft
      const line = sentences.map((s) => s.text).join(' ');
      if (!plan) state.turn += 1; // Phase B: v2's machine already advanced the turn
      state.lang = replyLang; state.lastLine = line; state.lastBase = line;
      const svcRefs = [...new Set(verdicts.filter((r) => r.verdict === 'pass').flatMap((r) => r.refs).map((id) => note.byId.get(id)).filter((f) => f && f.serviceId).map((f) => f.name))];
      if (svcRefs.length === 1) { const s = (profile.servicesCatalog || []).find((x) => x.name === svcRefs[0]); if (s) { state.lastService = s; c.service = { name: s.name, turn: state.turn }; } }
      if (cbOffered === 'offered_now') { state.offer = 'callback'; state.offerService = null; c.offer = { type: 'callback', service: null, turn: state.turn }; c.callback = { status: 'offered', reason: 'unknown_fact' }; }
      c.repairCount = 0;
      (state.trace || (state.trace = [])).push({ turn: state.turn, v1_draft: { verdicts: verdicts.map((r) => r.verdict) } });
    } else path = handoff ? 'v2_action' : 'v2_fallback';
    trace.path = path;
    try { onStage(trace); } catch { /* trace only */ }
    log(`[brain_v1_draft] path=${path} used=${res.used || '-'} attempts=${res.attempts.map((a) => `${a.model}:${a.ok ? 'ok' : a.err}`).join(',')} sentences=${sentences.length} replaced=${replaced}`);
    return { path, sentences, line: sentences.map((s) => s.text).join(' '), turnFields, trace, proposals };
  }
  return { turn, partial, cancel };
}
function langOf(state, langLock, text) {
  const l = RO.turnLang(state.lang, langLock, text) || state.lang || langLock || 'en';
  return /^(sw|sheng)/.test(String(l)) ? 'sw' : 'en';
}
function writesOf(state) {
  return [...(state.callbacks || []).filter((c) => c && c.id).map((c) => ({ id: c.id, kind: 'callback' })), ...(state.receipts || []).filter((r) => r && r.ok !== false && r.id && /appointment|booking/.test(String(r.kind || r.tool || ''))).map((r) => ({ id: r.id, kind: 'booking' }))];
}
/** History the model reads: caller words and the lines actually spoken (any path). */
/** Phase A: the draft's understanding in v2's turnFields shape (turnModel.fieldsOf). Fact ids (S#/P#)
 * map to catalogue ids; a propose_booking adds 'book'. null when the model gave nothing usable. */
function handoffFields({ asks, proposals = [], note, profile = {} }) {
  const out = new Set(); let place = null; let serviceId = null;
  const toSvc = (id) => {
    if (!id) return null;
    const f = note && note.byId && note.byId.get(String(id));
    if (f && f.serviceId) return f.serviceId;
    const row = (profile.servicesCatalog || []).find((x) => x.id === id || x.factId === id);
    return row ? row.id : null;
  };
  if (asks) {
    for (const a of asks.asks || []) if (['place', 'explain', 'price', 'possible', 'book', 'check_or_correct_detail'].includes(a)) out.add(a);
    if (typeof asks.place === 'string' && asks.place.trim()) place = asks.place.trim().slice(0, 60);
    for (const id of asks.service_ids || []) { serviceId = toSvc(id); if (serviceId) break; }
  }
  for (const p of proposals) {
    if (p.name === 'propose_booking') { out.add('book'); if (!serviceId) serviceId = toSvc(p.args && p.args.service_id); }
  }
  if (!out.size && !place && !serviceId) return null;
  return { asks: [...out], place, service_id: serviceId };
}
function remember(state, role, text) {
  if (!text) return;
  const h = state.v1History || (state.v1History = []);
  h.push({ role, text: String(text).slice(0, 400) });
  if (h.length > HISTORY * 2) h.splice(0, h.length - HISTORY * 2);
}
module.exports = { mode, phaseA, phaseALine, PHASE_A_LINES, handoffFields, createV1Draft, ladder, buildRequest, v2OwnsTurn, remember, DEADLINES, DND_TENANT, staticPrefix };
