'use strict';
// Live BA v2 turn. BRAIN_V2=on and BRAIN_V2_MODE=live. Speaks receipt
// sentences. Writes go through createLiveHandlers. Flag off = unused.

const { brainV2Enabled, brainV2Mode } = require('./flag');
const { createState, turnLang } = require('./machine');
const { runTurnStream } = require('./stream');
const { createLiveHandlers } = require('./liveHandlers');
const { createClassifyAsk } = require('./classifyAsk');
const { createGeminiSend, createGeminiStreamModel } = require('./transport');
const MS = require('./modelShadow');
const TM = require('./turnModel');
const V1 = require('./v1draft');

// C7 BRAIN_V2_MODEL: off (default) = nothing; shadow = the model runs beside the rules turn,
// never awaited, logged per turn; on = the capped cascade is also handed to the machine's
// existing consultModel hook. Cascade: primary (BRAIN_V2_MODEL_ID / gemini-3.6-flash) first;
// on HARD_CAP timeout or hard fail, one backup (BRAIN_V2_MODEL_BACKUP_ID / gemini-3.5-flash-lite)
// inside the same overall cap (not 900+900).
// The key is Platform's env (GEMINI_API_KEY). Model plaintext is never TTS'd.
// how long the reply waits after the final for the turn's fields (partial-started calls are usually done)
const TURN_MODEL_WAIT_MS = 750;

function resolveModelShadow(opts = {}, env = process.env) {
  const mode = MS.modelMode(env);
  if (mode === 'off') return null;
  const ids = MS.resolveModelIds(env);
  let model = typeof opts.shadowModel === 'function' ? opts.shadowModel : null;
  let backupModel = typeof opts.shadowBackupModel === 'function' ? opts.shadowBackupModel : null;
  if (!model) {
    const key = env.GEMINI_API_KEY;
    if (!key) { (opts.log || console.log)('[brain_v2_model] no GEMINI_API_KEY; model shadow off for this call'); return null; }
    try {
      model = createGeminiStreamModel({ apiKey: key, model: ids.primary });
      if (ids.backup && ids.backup !== ids.primary) {
        backupModel = createGeminiStreamModel({ apiKey: key, model: ids.backup });
      }
    } catch { return null; }
  }
  const shadow = MS.createModelShadow({
    model,
    backupModel,
    mode,
    onStage: typeof opts.onModelStage === 'function' ? opts.onModelStage : () => {},
    log: opts.log || ((m) => console.log(m)),
    modelId: ids.primary,
    backupModelId: ids.backup,
  });
  let turnModel = null;
  if (mode === 'on') {
    // One model call per turn: the extraction call, shared with Voice's unfinished hold by callSid.
    const streams = { [ids.primary]: model, ...(backupModel ? { [ids.backup]: backupModel } : {}) };
    const key = env.GEMINI_API_KEY;
    if (key && typeof opts.shadowModel !== 'function') TM.prewarm({ apiKey: key, modelId: ids.primary }).catch(() => {});
    turnModel = TM.forCall(opts.callSid || null, () => TM.createTurnModel({
      streamFor: (id) => streams[id] || model,
      primaryId: ids.primary,
      backupId: ids.backup,
      onStage: typeof opts.onModelStage === 'function' ? opts.onModelStage : () => {},
      log: opts.log || ((m) => console.log(m)),
    }));
  }
  return { mode, shadow, model, backupModel, modelId: ids.primary, backupModelId: ids.backup, turnModel };
}

function defaultClassify(opts = {}) {
  if (typeof opts.classify === 'function') return opts.classify;
  const key = opts.apiKey || (opts.env && opts.env.GEMINI_API_KEY) || process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    return createClassifyAsk({
      send: createGeminiSend({ apiKey: key, timeoutMs: 1200, model: opts.classifyModel || 'gemini-3.5-flash-lite' }),
      timeoutMs: 1200,
    });
  } catch {
    return null;
  }
}

function callerFile(opts = {}) {
  const file = opts.callerFile || {};
  // Rows come from callerMemory.structuredOpenRows ({ kind, type, job, when, windowStart })
  // or raw DB rows. Keep what the row is (a visit, or a callback / enquiry request) and the
  // caller's own date words, so a request is never read back as a cancellable visit
  // with an empty date ("... one bedroom on . Shall I go ahead?").
  const openRows = (Array.isArray(file.openRows) ? file.openRows : []).map((r) => {
    const type = r.type || r.request_type || null;
    const kind = r.kind === 'visit' || r.kind === 'request'
      ? r.kind
      : (r.request_type || (type && type !== 'visit') ? 'request' : 'visit');
    return {
      id: r.id || null,
      kind,
      type,
      service_name: r.service_name || r.job || r.item || null,
      window_start: r.window_start || r.windowStart || null,
      when_text: r.when_text || r.whenText || (typeof r.when === 'string' ? r.when : null) || null,
      address_landmark: r.address_landmark || r.place || null,
      status: r.status || 'requested',
    };
  });
  return {
    callerPhone: file.callerPhone || opts.callerPhone || null,
    contactName: file.contactName || file.displayName || null,
    displayName: file.displayName || file.contactName || null,
    openRows,
    sharedLine: file.sharedLine === true,
    nameConfirmed: file.nameConfirmed === true,
    returning: file.returning === true
      || Boolean(file.contactName && file.nameConfirmed === true)
      || openRows.some((r) => r && r.service_name),
    lastVisit: file.lastVisit && (file.lastVisit.service_name || file.lastVisit.job || file.lastVisit.service)
      ? {
          id: file.lastVisit.id || null,
          kind: file.lastVisit.kind === 'request' ? 'request' : 'visit',
          type: file.lastVisit.type || null,
          service_name: file.lastVisit.service_name || file.lastVisit.job || file.lastVisit.service || null,
          window_start: file.lastVisit.window_start || file.lastVisit.windowStart || null,
          when_text: file.lastVisit.when_text || file.lastVisit.whenText || (typeof file.lastVisit.when === 'string' ? file.lastVisit.when : null) || null,
          address_landmark: file.lastVisit.address_landmark || file.lastVisit.place || null,
          status: file.lastVisit.status || 'done',
        }
      : null,
  };
}

// End-call contract (plan C3; Voice reads it with endSignalFromBrain): v2 emits { line, end: true, reason }
// once per call, on the turn whose line is the goodbye. Never while a write is proposed and
// not committed, never after a failed write this turn, never when the owner turned the
// end_call tool off (tenants.agent_tools.end_call = false), never with an empty line.
// An ack run ("sawa, sawa, sawa") says goodbye but does not hang up: a caller who is
// listening is not a caller who is done (bottleneck row 18).
const NO_HANGUP_REASONS = new Set(['ack_run']);
function endDecision({ done, machine, profile, line, alreadyEnded }) {
  if (!done || done.end !== true) return { end: false };
  const reason = String(done.endReason || 'caller_done').slice(0, 120);
  if (alreadyEnded) return { end: false, held: 'already_ended' };
  if (!String(line || '').trim()) return { end: false, held: 'empty_line' };
  if (done.awaitingConfirm || machine?.phase === 'readback' || machine?.pending) return { end: false, held: 'write_pending' };
  if ((done.toolResults || []).some((r) => r && (r.status === 'failed' || r.ok === false || r.error))) return { end: false, held: 'write_failed' };
  if (profile?.agentTools && profile.agentTools.end_call === false) return { end: false, held: 'end_call_off' };
  if (NO_HANGUP_REASONS.has(reason)) return { end: false, held: reason };
  return { end: true, reason };
}

function createBrainV2Live(opts = {}) {
  const env = opts.env || process.env;
  const applyTools = opts.applyTools;
  // Injectable clock (tests pin a daytime EAT instant; "tomorrow" before 06:00 EAT asks
  // "later today or <next day>?", so wall-clock tests must not depend on when CI runs).
  const nowFn = typeof opts.now === 'function' ? opts.now : opts.now ? () => new Date(opts.now) : () => new Date();
  let state = null;
  let endSent = false;
  let modelRun; // undefined = not resolved yet (C7)
  let lastShadow = Promise.resolve(null);
  let drafter; // BRAIN_V1_DRAFT per-call drafter (undefined = not resolved)
  function v1Drafter(profile) {
    if (drafter !== undefined) return drafter;
    drafter = null;
    const ids = MS.resolveModelIds(env);
    let streamFor = typeof opts.v1DraftStreamFor === 'function' ? opts.v1DraftStreamFor : null;
    if (!streamFor) {
      const key = env.GEMINI_API_KEY;
      if (!key) { (opts.log || console.log)('[brain_v1_draft] no GEMINI_API_KEY; v2 answers this call'); return null; }
      const models = {};
      streamFor = (id) => models[id] || (models[id] = createGeminiStreamModel({ apiKey: key, model: id }));
      TM.prewarm({ apiKey: key, modelId: ids.primary }).catch(() => {});
    }
    drafter = V1.createV1Draft({
      streamFor, primaryId: ids.primary, backupId: ids.backup,
      onStage: (st) => { try { (opts.onModelStage || (() => {}))(st); } catch { /* trace only */ } },
      log: opts.log || ((m) => console.log(m)),
      ...(opts.v1DraftDeadlines ? { deadlines: opts.v1DraftDeadlines } : {}),
      ...(opts.v1DraftSleep ? { sleep: opts.v1DraftSleep } : {}),
    });
    return drafter;
  }

  function ensureState(profile) {
    if (state) return state;
    const file = callerFile(opts);
    state = createState({
      profile: profile || {},
      callerPhone: file.callerPhone,
      contactName: file.contactName,
      openRows: file.openRows,
      sharedLine: file.sharedLine,
      nameConfirmed: file.nameConfirmed,
      returning: file.returning,
      lastVisit: file.lastVisit,
      callId: opts.callSid || null,
    });
    return state;
  }

  async function run({ text, profile, langLock, shouldAbort, onSentence, heardAgent = null } = {}) {
    if (!brainV2Enabled({ env, tenantId: profile?.id }) || brainV2Mode({ env }) !== 'live') {
      return null;
    }
    const machine = ensureState(profile);
    // BRAIN_V1_DRAFT: the model drafts, the KB verifies each sentence; v2 below is the total fallback.
    const vdMode = V1.mode({ env, tenantId: profile?.id });
    let vdFields = null; let vdPath = null;
    const vd = vdMode !== 'off' ? v1Drafter(profile) : null;
    const pA = !!vd && V1.phaseA({ env, tenantId: profile?.id });
    // Phase A: lines the caller heard outside the brain (greeting, opening ladder, acks) join the draft's history
    if (pA && Array.isArray(heardAgent)) for (const l of heardAgent) if (l && String(l).trim()) V1.remember(machine, 'agent', String(l).trim());
    if (vd) V1.remember(machine, 'caller', text);
    // Phase B (single brain): v2's call plan decides the step and does the writes FIRST (rules, no model);
    // then the model speaks every turn, phrasing that step. No owner switch. Template = total fallback.
    // BRAIN_MODEL_LEAD: one structured model call leads; code owns state and guards (off = the #932 path below)
    if (vd && vdMode === 'on' && ML.leadOn({ env, tenantId: profile?.id })) return runModelLead({ text, profile: profile || {}, langLock, shouldAbort, onSentence, machine });
    const core = !!vd && CC.coreOn({ env, tenantId: profile?.id });
    if (vd && vdMode === 'on' && (core || CP.phaseB({ env, tenantId: profile?.id }))) return runPhaseB({ text, profile: profile || {}, langLock, shouldAbort, onSentence, machine, vd, core });
    if (vd && vdMode === 'on') {
      const d = await vd.turn({ text, profile: profile || {}, state: machine, langLock: langLock === 'en' || langLock === 'sw' ? langLock : null, onSentence, shouldAbort: typeof shouldAbort === 'function' ? shouldAbort : () => false, turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null, phaseA: pA });
      vdPath = d.path;
      if (d.path === 'v1_draft') {
        V1.remember(machine, 'agent', d.line);
        return { line: d.line, lang: d.sentences[0]?.lang || machine.lang || 'en', sentences: d.sentences, end: false, phase: machine.phase, path: 'v1_draft', streamed: typeof onSentence === 'function' };
      }
      vdFields = d.turnFields;
    } else if (vd && vdMode === 'shadow') {
      // shadow: draft + verify on a copy of the state, never spoken, traced only
      let copy = null; try { copy = structuredClone(machine); } catch { copy = null; }
      if (copy) vd.turn({ text, profile: profile || {}, state: copy, langLock, turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null }).catch(() => {});
    }
    const handlers = createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: { tenantId: profile?.id || null, callSid: opts.callSid || null, callId: opts.callId || null, callerPhone: machine.callerPhone || null, recordWriteReceipt: opts.recordWriteReceipt, confirmCallerName: opts.confirmCallerName } });
    const sentences = [];
    let done = null;
    if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
    // shadow: snapshot before the rules turn; the model call starts now and is never awaited here
    // Phase A (voice-qa 926 §2.1): one understanding per turn. The draft's own model result (vdFields) when it
    // handed off with one; else v2's turn model runs as normal. No background shadow and no flash-lite
    // classify while the draft is on.
    const draftOn = !!(vd && vdMode === 'on');
    const on = !!(modelRun && modelRun.mode === 'on' && modelRun.turnModel) && (!draftOn || (pA && !vdFields));
    let turnFields = null;
    if (on) {
      const fileNames = (machine.file?.openRows || []).map((r) => r && r.service).filter(Boolean).slice(0, 3);
      const note = fileNames.length ? `caller file: ${fileNames.join(', ')}` : '';
      const tIdx = typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null;
      const r = await modelRun.turnModel.forFinal({ text, profile: profile || {}, note, budgetMs: core ? (opts.coreUnderstandMs ?? CORE_UNDERSTAND_MS) : (opts.turnModelWaitMs ?? TURN_MODEL_WAIT_MS), turnIndex: tIdx });
      turnFields = r.fields;
      if (pA) { try { require('../geminiProviderHealth').noteBrainModel(r.fields ? { ok: true, model: 'turn_model' } : { ok: false, model: 'turn_model', err: 'no_fields' }); } catch { /* best effort */ } }
    }
    const finishShadow = modelRun && !on && !(pA && draftOn) ? modelRun.shadow.begin({ text, state: machine, profile: profile || {}, turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null, openRows: machine.file?.openRows || [] }) : null;
    const it = runTurnStream(machine, {
      text,
      profile: { ...(profile || {}) },
      now: nowFn(),
      handlers,
      // mode=on: the turn's one call already ran (turnFields); no second machine/classify call
      model: opts.model || null,
      classify: on || (pA && draftOn && vdFields) ? null : defaultClassify(opts),
      turnFields: turnFields || vdFields,
      langLock: langLock === 'en' || langLock === 'sw' ? langLock : null,
      shouldAbort: typeof shouldAbort === 'function' ? shouldAbort : () => false,
    });
    for await (const ev of it) {
      if (!ev) continue;
      if (ev.type === 'sentence') sentences.push({ text: pA ? spokenStyle(ev.text, ev.lang) : ev.text, lang: ev.lang });
      if (ev.type === 'done') done = ev;
    }
    if (finishShadow) lastShadow = finishShadow(machine, done); // compared and logged off the critical path
    let line = sentences.map((s) => s.text).join(' ').trim() || (pA ? spokenStyle(String(done?.line || ''), machine.lang) : String(done?.line || '')).trim();
    if (pA && line) line = answerPossible({ text, fields: vdFields || turnFields, machine, line, sentences });
    if (vd) V1.remember(machine, 'agent', line);
    const endCall = endDecision({ done, machine, profile, line, alreadyEnded: endSent });
    if (endCall.end) endSent = true;
    return {
      line,
      lang: sentences[0]?.lang || machine.lang || langLock || 'en',
      sentences,
      end: endCall.end,
      ...(endCall.end ? { reason: endCall.reason } : {}),
      ...(endCall.held ? { endHeld: endCall.held } : {}),
      phase: done?.phase || machine.phase,
      ...(vdPath ? { path: vdPath } : {}),
    };
  }

  async function runPhaseB({ text, profile, langLock, shouldAbort, onSentence, machine, vd, core = false }) {
    // BRAIN_CALL_CORE: typed events + the reducer pre-step run first; the core is the only state writer
    const T0 = Date.now(); const ms = {}; let evs = []; let preWrites = []; let snap0 = null; let n0 = 0;
    if (core) { text = CC.normalize(text); machine.core = true; snap0 = CC.snapshot(machine); n0 = (machine.receipts || []).length; evs = CC.events(text, machine, profile); preWrites = CC.applyPre(machine, evs); ms.events = Date.now() - T0; }
    const abort = typeof shouldAbort === 'function' ? shouldAbort : () => false;
    const lock = langLock === 'en' || langLock === 'sw' ? langLock : null;
    const handlers = createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: { tenantId: profile?.id || null, callSid: opts.callSid || null, callId: opts.callId || null, callerPhone: machine.callerPhone || null, recordWriteReceipt: opts.recordWriteReceipt, confirmCallerName: opts.confirmCallerName } });
    // latency (RCA #3): the draft starts NOW, in parallel with the plan, understanding and machine; its sentences
    // are buffered and only spoken through the plan's gate. BRAIN_V1_DRAFT_PHASE_B_PARALLEL=off restores serial.
    const parallel = String(env.BRAIN_V1_DRAFT_PHASE_B_PARALLEL || 'on').toLowerCase() !== 'off';
    const startedOn = parallel ? vd.prelaunch({ text, profile, state: machine, langLock: lock }) : null;
    const pre = await CP.before(machine, text, profile, { handlers, lang: lock || turnLang(machine, null, text) });
    let tmpl; let lang = machine.lang || lock || 'en'; let done = null; let turnFieldsOut = null;
    if (pre.owned) { tmpl = pre.line; lang = pre.lang || lang; } else {
      const parts = [];
      // understanding: v2's one turn-model call (same as today's v2 turns), rules if it is off or misses 750 ms.
      // BRAIN_V1_DRAFT_PHASE_B_UNDERSTAND=rules skips it (fastest; weaker on "Alvin is my name"). Design D1.
      let turnFields = null;
      if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
      if (String(env.BRAIN_V1_DRAFT_PHASE_B_UNDERSTAND || 'model').toLowerCase() !== 'rules' && modelRun && modelRun.mode === 'on' && modelRun.turnModel) {
        try { const r = await modelRun.turnModel.forFinal({ text: pre.text, profile, note: '', budgetMs: core ? (opts.coreUnderstandMs ?? CORE_UNDERSTAND_MS) : (opts.turnModelWaitMs ?? TURN_MODEL_WAIT_MS), turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null }); turnFields = r && r.fields || null; } catch { turnFields = null; }
      }
      turnFieldsOut = turnFields; if (core) ms.understand = Date.now() - T0;
      for await (const ev of runTurnStream(machine, { text: pre.text, profile: { ...profile }, now: nowFn(), handlers, model: null, classify: null, turnFields, langLock: lock, shouldAbort: abort })) {
        if (ev && ev.type === 'sentence') parts.push(ev.text); if (ev && ev.type === 'done') done = ev;
      }
      lang = machine.lang || lang;
      tmpl = (parts.join(' ').trim() || String(done?.line || '')).trim();
      tmpl = CP.after(machine, { line: tmpl }, { lang });
      // an owner fee/note for the place just named is always heard first (Desk preview line), then the step
      if (pre.lead && !tmpl.startsWith(pre.lead)) tmpl = `${pre.lead} ${tmpl}`.trim();
      machine.lastLine = tmpl; machine.lastBase = tmpl;
    }
    tmpl = spokenStyle(tmpl, lang);
    const st = CP.step(machine, tmpl, lang);
    let rp = null;
    if (core) {
      ms.reduce = Date.now() - T0;
      const lead = machine.coreLead || null; machine.coreLead = null;
      const evs2 = turnFieldsOut ? [...evs, ...CC.events('', null, profile, turnFieldsOut).filter((e) => !evs.some((x) => x.type === e.type && x.ask === e.ask))] : evs;
      const ans = CC.answers(evs2, text, machine, profile, lang, { already: pre.acts || [] });
      rp = CC.replyPlan({ st, tmpl, ans, lead, receipts: CC.receiptsSince(machine, n0), lang, profile });
    }
    // the plan's own line is the step: in full when its first sentence carries news (honest name check, added
    // item); a coverage answer + re-ask only adds its question (the model answers the coverage itself)
    if (pre.owned) { const full = (pre.acts || []).some((x) => /^(have_my_name|item_added|add_service|service_add|area_(excluded|outside|unknown))/.test(x)); const q = CP.split(tmpl).filter((x) => /\?\s*$/.test(x)).pop(); st.question = full || !q ? tmpl : q; } else if (pre.lead) st.question = tmpl;
    (machine.trace || (machine.trace = [])).push({ turn: machine.turn, call_plan: { items: st.items, step: st.kind, slot: st.slot || null, acts: pre.acts } });
    const d = await vd.turn({ text, profile, state: machine, langLock: lock, onSentence, shouldAbort: abort, turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null, phaseA: true, plan: rp ? { kind: st.kind, core: true, parallel, startedOn, template: rp.template, note: rp.note, check: rp.check, tail: rp.tail } : { kind: st.kind, parallel, startedOn, template: tmpl, note: CP.stepNote(st), check: (s, ctx) => CP.actCheck(s, st, ctx), tail: (a) => CP.tail(st, a) } });
    if (rp) tmpl = rp.template;
    const endCall = endDecision({ done, machine, profile, line: d.path === 'v1_draft' ? d.line : tmpl, alreadyEnded: endSent });
    if (endCall.end) endSent = true;
    const extra = { phase: machine.phase, plan: st.kind, end: endCall.end, ...(endCall.end ? { reason: endCall.reason } : {}) };
    if (core) {
      ms.compose = Date.now() - T0;
      const rec = { kind: 'call_core', turn: machine.turn, events: evs, writes: [...preWrites, ...CC.diff(snap0, CC.snapshot(machine))], stagesMs: ms, plan: rp.plan, path: d.path, firstSentenceMs: d.trace ? d.trace.firstSentenceMs : null, file: CC.callerFileTool(machine) };
      (machine.trace || (machine.trace = [])).push({ turn: machine.turn, call_core: rec });
      try { (opts.onModelStage || (() => {}))(rec); } catch { /* trace only */ }
      extra.core = true;
    }
    if (d.path === 'v1_draft') { V1.remember(machine, 'agent', d.line); return { line: d.line, lang: d.sentences[0]?.lang || lang, sentences: d.sentences, path: 'v1_draft', streamed: typeof onSentence === 'function', ...extra }; }
    V1.remember(machine, 'agent', tmpl);
    return { line: tmpl, lang, sentences: CP.split(tmpl).map((x) => ({ text: x, lang })), path: `plan_fallback:${d.path}`, ...extra };
  }

  // ---------------------------------------------------------------- BRAIN_MODEL_LEAD turn runner
  let leadStreams;
  function leadStreamFor() {
    if (leadStreams !== undefined) return leadStreams;
    leadStreams = null;
    if (typeof opts.modelLeadStreamFor === 'function') { leadStreams = opts.modelLeadStreamFor; return leadStreams; }
    const key = env.GEMINI_API_KEY; if (!key) return null;
    const models = {};
    leadStreams = (id) => models[id] || (models[id] = createGeminiStreamModel({ apiKey: key, model: id }));
    return leadStreams;
  }
  /** G5 + one name state: the booking write carries a clock the executor keeps, and the saved row must equal the read-back. */
  function leadHandlers(machine, profile, log) {
    const h = createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: { tenantId: profile?.id || null, callSid: opts.callSid || null, callId: opts.callId || null, callerPhone: machine.callerPhone || null, recordWriteReceipt: opts.recordWriteReceipt, confirmCallerName: opts.confirmCallerName } });
    const create = h.createAppointment; const update = h.updateAppointment;
    h.createAppointment = async (args) => {
      const m = String(args.whenText || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
      const when = m ? { date: m[1], time: m[2] } : null;
      const a2 = when ? { ...args, whenText: ML.storedWhenText(when) } : args;
      const res = await create(a2);
      if (!res.ok) { log.push({ g5: 'write_failed' }); return res; }
      const expected = { when, place: args.landmark || null, service: args.serviceName || null };
      let cmp = ML.compareSaved(expected, res.saved ? { ...res.saved, serviceName: res.saved.serviceName || args.serviceName } : null);
      log.push({ g5: 'compare', ok: cmp.ok, mismatch: cmp.mismatch || cmp.missing || [], id: res.id });
      if (cmp.ok || !res.saved) return { ...res, verified: cmp.ok, mismatch: cmp.mismatch || cmp.missing };
      // fix the write once (same row), then re-verify; still wrong = no booked line (honest failure path)
      if (res.id && when) {
        const fx = await update({ appointmentId: res.id, whenText: ML.storedWhenText(when), windowStart: L2.whenToIso(when) });
        cmp = ML.compareSaved(expected, fx && fx.saved ? { ...res.saved, ...fx.saved } : null);
        log.push({ g5: 'fix', ok: !!(fx && fx.ok && cmp.ok), mismatch: cmp.mismatch || cmp.missing || [] });
        if (fx && fx.ok && cmp.ok) return { ...res, verified: true, fixed: true };
      }
      // the machine reads success from result.id: a row that is still wrong must not look booked
      return { ok: false, id: null, rowId: res.id, error: 'saved_mismatch', verified: false, mismatch: cmp.mismatch };
    };
    const save = h.saveCallerInfo;
    h.saveCallerInfo = async (args) => { const locked = CP.lockedName(machine); const same = locked && args && String(args.name || '').toLowerCase() === String(locked).toLowerCase(); return applyTools ? (async () => { const ex = await applyTools({ saveCallerInfo: args, name: args?.name, ...(same ? { v2NameLocked: true } : {}) }); return ex; })() : save(args); };
    return h;
  }

  async function runModelLead({ text, profile, langLock, shouldAbort, onSentence, machine }) {
    const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
    const T0 = clock(); const ms = {}; const abort = typeof shouldAbort === 'function' ? shouldAbort : () => false;
    const lock = langLock === 'en' || langLock === 'sw' ? langLock : null;
    text = CC.normalize(text); machine.core = true; machine.lead = true;
    const snap0 = CC.snapshot(machine); const n0 = (machine.receipts || []).length;
    // 1) context pack + read-only tools in code (decision 1): caller file, coverage per place, KB
    const split = ML.splitOn({ env });
    // lookup_caller (real receipt tool, in RAM): runs pre-model on a booking/identity turn with the rules' filters
    const rowTurn = split && (ML.ROW_INTENT.test(text) || ['cancel', 'change', 'address_change'].includes(machine.intent) || machine.expecting === 'which' || machine.expecting === 'which_named');
    const lk = split ? ML.lookupCaller(machine.file || {}, rowTurn ? ML.callerFilters(text, profile, machine.leadLateU || null, nowFn()) : {}, { now: nowFn(), lockedName: CP.lockedName(machine) }) : null;
    const caller = lk || ML.callerReceipt(machine.file || {}, { now: nowFn(), lockedName: CP.lockedName(machine) });
    const coverage = ML.coverageFor(text, profile); // the ONE coverage source (confirmed picks first)
    const pack = ML.contextPack({ machine, text, profile, caller, coverage, langHint: lock });
    if (lk) pack.CALLER = { name: lk.name, candidate: lk.candidate, upcoming: lk.upcoming, past_jobs: lk.past_jobs, addresses: lk.addresses, notes: lk.notes, match: lk.match };
    const request = split ? ML.replyRequest(pack, profile) : ML.buildRequest(pack, profile);
    ms.pack = clock() - T0;
    // 2) model calls. Split: understanding (small, flash-lite) and reply (reply-first) start together; neither waits on the other.
    const ids = split ? ML.leadModels(env) : MS.resolveModelIds(env); const sf = leadStreamFor();
    const DL = opts.modelLeadDeadlines || (split ? ML.SPLIT_DEADLINES : ML.DEADLINES);
    const live = { u: null, reply: '', closed: false, tools: null, done: false, uDone: false };
    let kick = () => {}; const wake = () => { const k = kick; kick = () => {}; k(); };
    let uRes; const uP = new Promise((r) => { uRes = r; });
    let s1Res; const s1P = new Promise((r) => { s1Res = r; });
    const setU = (raw) => { const nu = split ? ML.normUnderstanding(raw) : raw; if (nu && !live.u) { live.u = nu; ms.understanding = clock() - T0; uRes(); wake(); } };
    const urun = split && sf ? ML.runHedged({ streamFor: sf, primaryId: ids.primary, backupId: ids.backup, request: ML.understandRequest({ text, machine }), deadlines: { hedgeMs: DL.understandHedgeMs ?? 600, hardMs: DL.hardMs }, clock, winWhen: () => false, okWhen: (full) => !!ML.normUnderstanding(full), onProgress: (a, p) => { if (p.full) setU(p.full); } }) : null;
    if (urun) urun.done.then(() => { live.uDone = true; uRes(); });
    const run = sf ? ML.runHedged({ streamFor: sf, primaryId: ids.primary, backupId: ids.backup, request, deadlines: DL, clock,
      ...(split ? { winWhen: (p) => typeof p.reply === 'string' && p.reply.length > 0, okWhen: (full) => !!(full && typeof full.reply === 'string') } : {}),
      onProgress: (a, p) => {
        if (!split && p.understanding && !live.u) { live.u = p.understanding; ms.understanding = clock() - T0; uRes(); }
        if (p.toolCalls) live.tools = p.toolCalls;
        if (typeof p.reply === 'string') { live.reply = p.reply; live.closed = !!p.replyClosed; if (ML.sentencesOf(live.reply, live.closed).length) s1Res(); }
        wake();
      } }) : null;
    if (run) run.done.then(() => { live.done = true; s1Res(); if (!split) uRes(); wake(); }); else { live.done = true; uRes(); s1Res(); }
    // join rule (split): understanding, or the reply's first sentence, or understandCapMs, whichever first. Never discards a late understanding.
    if (split) await Promise.race([uP, s1P, new Promise((r) => setTimeout(r, DL.understandCapMs ?? 1100))]);
    else await Promise.race([uP, new Promise((r) => setTimeout(r, DL.understandWaitMs))]);
    const u = live.u || (split ? machine.leadLateU || null : null);
    if (split && machine.leadLateU) machine.leadLateU = null;
    // a unique caller-file match fills the booking to change (never a past row); the machine's read-back still confirms it
    if (lk && rowTurn && lk.match.kind === 'unique' && machine.slots && !machine.slots.row) { const row = (machine.file && machine.file.openRows || []).find((r) => r.id === lk.match.row_id); if (row) machine.slots.row = row; }
    // 3) the state owner applies the turn (rules veto; the model's understanding is evidence)
    const g5 = []; const handlers = leadHandlers(machine, profile, g5);
    // the turn language is decided ONCE, before the call plan's pre-route, so every templated line follows it
    const tl = lock || turnLang(machine, null, text);
    // cancel question vs request: decided from the understanding (intent + a named booking/action), never word patterns
    const ck = ML.cancelKind(u, machine, text, profile, nowFn());
    const tf = ML.turnFieldsOf(u, profile); const fields = ck && ck !== 'clarify' ? { ...(tf || {}), cancelKind: ck } : tf;
    const pre = ck === 'clarify' ? CP.ownLine(machine, OW.render({ topic: 'clarify', sub: 'cancel', lang: tl }), 'cancel_clarify', tl) : await CP.before(machine, text, profile, { handlers, lang: tl });
    let tmpl; let lang = (u && (u.lang === 'sw' ? 'sw' : u.lang === 'en' ? 'en' : null)) || machine.lang || lock || 'en'; let done = null;
    if (lock) lang = lock;
    if (pre.owned) { tmpl = pre.line; lang = pre.lang || lang; } else {
      const parts = [];
      for await (const ev of runTurnStream(machine, { text: pre.text, profile: { ...profile }, now: nowFn(), handlers, model: null, classify: null, turnFields: fields, langLock: lock, shouldAbort: abort })) {
        if (ev && ev.type === 'sentence') parts.push(ev.text); if (ev && ev.type === 'done') done = ev;
      }
      lang = lock || machine.lang || lang;
      tmpl = (parts.join(' ').trim() || String(done?.line || '')).trim();
      tmpl = CP.after(machine, { line: tmpl }, { lang });
      if (pre.lead && !tmpl.startsWith(pre.lead)) tmpl = `${pre.lead} ${tmpl}`.trim();
      machine.lastLine = tmpl; machine.lastBase = tmpl;
    }
    if (lk && machine.expecting === 'which_named' && lk.upcoming.length) { const c = lk.match.candidates.length ? lk.match.candidates : lk.upcoming; tmpl = ML.offerRowsLine(c, lang); machine.lastLine = tmpl; }
    tmpl = spokenStyle(tmpl, lang);
    const st = CP.step(machine, tmpl, lang);
    if (pre.owned) { const q = CP.split(tmpl).filter((x) => /\?\s*$/.test(x)).pop(); st.question = q || tmpl; }
    ms.state = clock() - T0;
    const receipts = CC.receiptsSince(machine, n0);
    // places the model heard that the prefetch missed: resolved locally now (no second model call)
    if (u && u.slots && Array.isArray(u.slots.places)) { const extra = u.slots.places.filter((p) => !coverage.places.some((r) => r.place.toLowerCase() === String(p).toLowerCase() || r.said.toLowerCase() === String(p).toLowerCase())); if (extra.length) coverage.places.push(...ML.coverageReceipt(extra, profile).places.filter((r) => !coverage.places.some((x) => x.place === r.place))); }
    const rulesEvs = CC.events(text, null, profile);
    const questions = u ? (u.questions || []) : rulesEvs.filter((e) => e.type === 'ask').map((e) => ({ type: e.ask === 'pay' ? 'payment' : e.ask }));
    // any place the caller mentioned with no answer yet is owed a coverage answer (understanding and rules alike)
    ML.owedCoverageQuestion(questions, coverage.places, text, machine);
    // the call plan's owed confirmations (slots complete, next is the name/read-back): one more kind of owed answer
    const plo = pre.owned ? null : CP.owed(machine, profile, st);
    // tool_calls arrive after the understanding; they are hints (the machine commits writes), guarded + traced at the end
    const ctx = { st, receipts, coverage: coverage.places, caller, profile, questions, lang, machine, text, callerReadOk: !!lk, confirm: plo ? plo.items : [] };
    const ver = ML.makeVerifier(ctx);
    // 4) speak: verified sentences in order; questions held until the reply closes (owed answers go first)
    const spoken = []; const verdicts = []; let firstMs = null; let repairs = 0; let modelSentences = 0;
    // the single reply assembler: every producer (model, owed answer, template, reducer line) is deduped by fact here
    const asm = RF.createAssembler({ profile, coverage: coverage.places, lang });
    const emit = (s0, src) => { if (!s0 || abort()) return; const s = asm.admit(s0, { keep: src === 'fixed' }); if (!s) return; const t = spokenStyle(s, lang); spoken.push({ text: t, lang, src }); if (firstMs == null) firstMs = clock() - T0; if (typeof onSentence === 'function') { try { onSentence({ text: t, lang }); } catch { /* sink */ } } };
    const fixed = st.kind === 'readback' || st.kind === 'confirmed' || st.kind === 'add_service' || (pre.owned && (pre.acts || []).some((x) => /^(have_my_name|item_added|add_service|service_add|area_(excluded|outside|unknown))/.test(x)));
    let answeredBy = 'model';
    let held = null; let used = 0;
    const handle = async (s) => {
      const v = ver.check(s); verdicts.push({ s: s.slice(0, 160), verdict: v.verdict, reason: v.reason || null });
      if (v.verdict === 'drop') return;
      let out = v.text || s; let src = v.verdict === 'pass' ? 'model' : 'step';
      if (v.verdict === 'repair') {
        repairs += 1; out = v.fix; src = 'repair_template';
        const left = DL.hardMs - (clock() - T0);
        if (sf && left >= ML.DEADLINES.repairMinLeftMs && opts.modelLeadRepair !== false) {
          const r = await repairSentence({ sf, id: ids.backup, bad: s, fix: v.fix, lang, capMs: Math.min(left, ML.DEADLINES.repairCapMs) });
          if (r) { const v2 = ML.makeVerifier({ ...ctx, coverage: ctx.coverage.slice() }).check(r); if (v2.verdict === 'pass') { out = r; src = 'repair_model'; } }
        }
      }
      if (fixed && (/\?\s*$/.test(out) || CC.CLAIM.test(out))) return; // the fixed line carries the step
      if (/\?\s*$/.test(out)) { if (!held) held = out; return; }
      if (src === 'model') modelSentences += 1;
      emit(out, src);
    };
    if (run) {
      for (;;) {
        const all = ML.sentencesOf(live.reply, live.closed || live.done);
        while (used < all.length) { if (abort()) break; await handle(all[used]); used += 1; }
        if (live.closed || live.done || abort()) break;
        await new Promise((r) => { kick = r; setTimeout(r, 50); });
      }
    }
    // late understanding (split): never discarded; its questions/places still get answered this turn, and it carries to the next turn
    if (split && !u && live.u) {
      const lu = live.u; machine.leadLateU = lu;
      for (const q of lu.questions || []) if (!questions.some((x) => x.type === q.type)) questions.push(q);
      const extra = (lu.slots && lu.slots.places || []).filter((p) => !coverage.places.some((r) => r.place.toLowerCase() === String(p).toLowerCase()));
      if (extra.length) coverage.places.push(...ML.coverageReceipt(extra, profile).places);
    }
    // exactly one voice: any model output that passed the guard (or was repaired) owns the turn; template only when every model failed
    const modelOk = split ? !!(modelSentences || held || repairs) : !!(u && (modelSentences || held || used));
    if (!modelOk) answeredBy = split && used > 0 ? 'template_vetoed' : 'template'; // vetoed = the model answered but every sentence failed the guard
    if (answeredBy === 'template' || answeredBy === 'template_vetoed') {
      // all models failed (or every model sentence was vetoed): the ONE owed-answer list (owed.js), worded by code in
      // the turn language, then only the step's question from the reducer line (its own answer text is replaced)
      // a cancel request is answered by the machine's own step; a clarify turn answers nothing yet (no guessed policy)
      const list = ck === 'clarify' ? [] : OW.collect({ questions, coverage: coverage.places, text, profile, machine, lang, confirm: ctx.confirm, policyScan: !u && ck !== 'request' });
      const lines = list.map((o) => OW.render(o, ctx)).filter(Boolean);
      let base = tmpl;
      if (split && !questions.some((q) => q.type === 'price')) base = CP.split(base).filter((x) => !ML.UNASKED_PRICE(x)).join(' ');
      if (lines.length && !fixed) base = CP.split(base).filter((x) => /\?\s*$/.test(x) && !/not getting that|sikupati|sijakuelewa/i.test(x)).join(' ');
      if (plo && plo.blocked) base = lang === 'sw' ? 'Kazi iko eneo lingine?' : 'Is the job anywhere else?'; // [PROMPT-PLACEHOLDER]
      if (lines.some((l) => /\?\s*$/.test(l))) base = CP.split(base).filter((x) => !/\?\s*$/.test(x)).join(' ');
      for (const l of lines) emit(l, 'template');
      emit(base, 'template');
    } else {
      for (const a of ML.owedAnswers(ctx, spoken.map((x) => x.text).join(' '))) emit(a.text, 'owed_answer');
      if (fixed) { emit(st.kind === 'readback' ? st.readback : tmpl, 'fixed'); if (!modelSentences) answeredBy = 'fixed'; }
      else {
        const stepQ = st.kind === 'ask' || st.kind === 'confirm_name' ? CP.tail(st, ver.act) : null;
        if (held) emit(held, 'model'); else if (stepQ) emit(stepQ, 'step');
      }
      if (repairs) answeredBy = `${answeredBy}+repair`;
    }
    if (plo) CP.markOwed(machine, plo);
    const line = spoken.map((x) => x.text).join(' ').trim() || tmpl;
    V1.remember(machine, 'agent', line);
    const endCall = endDecision({ done, machine, profile, line, alreadyEnded: endSent });
    if (endCall.end) endSent = true;
    ms.total = clock() - T0;
    const runInfo = run ? await Promise.race([run.done, Promise.resolve(null)]) : null;
    const rec = {
      kind: 'model_lead', stage: 'brain_model_lead', turn: machine.turn, turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null,
      attempts: (run ? run.attempts : []).map((a) => ({ model: a.model, role: a.role, startMs: a.startMs, firstTokenMs: a.firstTokenMs, ms: a.ms, outcome: a.outcome || (a.end ? null : 'streaming') })),
      understanding: u || null, toolCalls: ML.guardTools(live.tools || [], machine, caller), receipts: { caller: { name: caller.name, candidate: caller.candidate, last_past_job: caller.last_past_job, upcoming: caller.upcoming.length, upcoming_count: caller.upcoming_count }, coverage: coverage.places.map((r) => ({ place: r.place, covered: r.covered, source: r.source })), writes: receipts.map((r) => ({ tool: r.tool, ok: r.ok, id: r.id })), g5 },
      verdicts, answeredBy, step: st.kind, writes: CC.diff(snap0, CC.snapshot(machine)), stagesMs: ms, firstSentenceMs: firstMs, why: runInfo && runInfo.why || null,
    };
    (machine.trace || (machine.trace = [])).push({ turn: machine.turn, model_lead: rec });
    try { (opts.onModelStage || (() => {}))(rec); } catch { /* trace only */ }
    return { line, lang, sentences: spoken.map((x) => ({ text: x.text, lang: x.lang })), path: /^template/.test(answeredBy) ? 'model_lead_template' : 'model_lead', streamed: typeof onSentence === 'function', phase: machine.phase, plan: st.kind, lead: true, answeredBy, end: endCall.end, ...(endCall.end ? { reason: endCall.reason } : {}), ...(endCall.held ? { endHeld: endCall.held } : {}) };
  }

  /** Voice's unfinished hold: start this turn's one model call on the stable partial. */
  function partial({ text, profile, langLock } = {}) {
    if (CP.phaseB({ env, tenantId: profile?.id })) {
      // Phase B: the draft starts on the stable partial (no owner switch, so every turn), the understanding warms too
      if (String(env.BRAIN_V1_DRAFT_PHASE_B_PARALLEL || 'on').toLowerCase() === 'off' || !state) return false;
      const d = v1Drafter(profile); let ok = false;
      if (d) ok = d.partial({ text, profile: profile || {}, state, langLock, plan: true });
      if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
      try { if (modelRun && modelRun.mode === 'on' && modelRun.turnModel) modelRun.turnModel.partial({ text, profile: profile || {} }); } catch { /* warm only */ }
      return ok;
    }
    // Phase A: a turn the draft hands to v2 anyway (read-back, action flow) warms v2's one model call instead
    if (V1.phaseA({ env, tenantId: profile?.id }) && state && V1.v2OwnsTurn(state, text)) {
      if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
      return !!(modelRun && modelRun.mode === 'on' && modelRun.turnModel && modelRun.turnModel.partial({ text, profile: profile || {} }));
    }
    if (V1.mode({ env, tenantId: profile?.id }) === 'on' && state) { const d = v1Drafter(profile); if (d) return d.partial({ text, profile: profile || {}, state, langLock }); }
    if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
    if (!modelRun || modelRun.mode !== 'on' || !modelRun.turnModel) return false;
    return !!modelRun.turnModel.partial({ text, profile: profile || {} });
  }
  // call start: resolve the model (prewarm the warm client) before the first caller turn
  if (opts.prewarm !== false && V1.mode({ env, tenantId: opts.tenantId }) !== 'off' && env.GEMINI_API_KEY) TM.prewarm({ apiKey: env.GEMINI_API_KEY, modelId: MS.resolveModelIds(env).primary }).catch(() => {});
  if (opts.prewarm !== false && MS.modelMode(env) === 'on' && modelRun === undefined) modelRun = resolveModelShadow(opts, env);

  return { run, partial, getState: () => state, lastModelShadow: () => lastShadow };
}


const AM = require('./audibleMouth');
const { spoken: spokenStyle } = require('./spokenStyle');
const TRZ = require('./turnResolver');
const RCP = require('./receipts');
const CP = require('./callPlan');
const CC = require('./callCore');
const ML = require('./modelLead');
const L2 = require('./lexicon');
const RF = require('./replyFacts');
const OW = require('./owed');
const OF = require('./ownerFacts');
/** Decision 3: one bad sentence gets a quick model rewrite when >=300 ms is left (light model), else the code line. */
async function repairSentence({ sf, id, bad, fix, lang, capMs }) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), capMs);
  try {
    const request = { systemInstruction: { parts: [{ text: 'Rewrite the receptionist sentence so it states ONLY the fact given, naturally, one short sentence, same language. Return only the sentence.' }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify({ wrong: bad, fact: fix, lang }) }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 60, thinkingConfig: { thinkingLevel: 'MINIMAL' } } };
    let out = ''; const r = await sf(id)({ request, signal: ac.signal, onText: (d) => { out += d; } });
    const s = String((r && r.text) || out).trim().replace(/^"|"$/g, '');
    return s && s.length < 220 ? s : null;
  } catch { return null; } finally { clearTimeout(t); }
}
const CORE_UNDERSTAND_MS = 450; // BRAIN_CALL_CORE latency budget: understanding <= 450 ms
/** Phase A (voice-qa 926 §2.2): a handed-off "is it possible?" with a catalogue service gets a yes before
 * v2's next question ("Yes, we do interior window cleaning. Where should we come?"). Coverage and hours
 * are still checked by v2's own place/time steps; this only answers the service half. */
function answerPossible({ text, fields, machine, line, sentences }) {
  const asked = (fields && (fields.asks || []).includes('possible')) || TRZ.POSSIBLE.test(String(text || ''));
  const svc = machine && machine.slots && machine.slots.service;
  if (!asked || !svc || machine.phase === 'readback' || machine.pending) return line;
  if (/^(yes|yeah|sure|sorry|ndio|ndiyo|sawa|samahani)\b/i.test(line) || line.toLowerCase().includes(String(svc).toLowerCase())) return line;
  const lang = (sentences[0] && sentences[0].lang) || machine.lang || 'en';
  const sw = /^sw/.test(lang);
  const name = RCP.svcName(svc, lang);
  const yes = sw ? `Ndio, tunafanya ${name}.` : `Yes, we do ${String(name).toLowerCase()}.`;
  sentences.unshift({ text: yes, lang });
  return `${yes} ${line}`;
}

/** Voice composeOpening card from the same bind-safe facts Brain seeds into machine.file.
 * Field names locked with Voice @ 45c2d51f — do not rename.
 * openRows may carry D199 `job` (mapped to service_name here for Brain seed).
 */
function openingCardFromCallerFile(opts = {}) {
  const file = callerFile(opts);
  return AM.bindSafeOpeningCard(file, {
    name: file.nameConfirmed ? file.contactName : null,
    nameConfirmed: file.nameConfirmed === true,
  }, opts.staffNames || [], { lastLanguage: opts.lastLanguage || file.lastLanguage || null });
}

module.exports = { createBrainV2Live, callerFile, openingCardFromCallerFile, endDecision, resolveModelShadow };

