'use strict';
// Live v2 turn: the only caller-turn brain (B2 removed the old Gemini-prompt turn and every flag that picked it).
// Each turn runs the engines (brainEngines.js). Writes go through createLiveHandlers.

const BE = require('./brainEngines');
const { createState } = require('./machine');
const { createLiveHandlers } = require('./liveHandlers');
const { createGeminiStreamModel } = require('./transport');
const MS = require('./modelShadow');
const TM = require('./turnModel');
const V1 = require('./v1draft');
const R = require('./receipts');
const { recordBrainError } = require('./brainErrorRecord');

// C7 BRAIN_V2_MODEL: off (default) = nothing; shadow = the model runs beside the rules turn,
// never awaited, logged per turn; on = the capped cascade is also handed to the machine's
// existing consultModel hook. Cascade: primary (BRAIN_V2_MODEL_ID / gemini-3.6-flash) first;
// on HARD_CAP timeout or hard fail, one backup (BRAIN_V2_MODEL_BACKUP_ID / gemini-3.5-flash-lite)
// inside the same overall cap (not 900+900).
// The key is Platform's env (GEMINI_API_KEY). Model plaintext is never TTS'd.

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
  function ensureState(profile) {
    if (state) return state;
    // stream resume (Voice openingCarry): continue the SAME v2 machine (turn index, locked name, language, asked questions)
    if (opts.resumeState && typeof opts.resumeState === 'object' && opts.resumeState.slots) {
      state = opts.resumeState;
      state.resumed = (state.resumed || 0) + 1;
      state.lastStepQ = null;
      return state;
    }
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

  // B2: every turn runs the engines (understanding -> plan -> tools -> guarded reply), in brainMode full or safe
  // (brainModeAdapter.callMode, pinned per call). There is no other path: no null return, no Phase B / #932 draft /
  // model-lead-without-engines branch, no model shadow. With no model configured (no GEMINI_API_KEY, no stand-in)
  // the engines run on rules understanding + template lines (the v2 template is the only in-brain fallback);
  // ownsCall.runOwnedTurn speaks the v2 repair line if this throws.
  async function run({ text, profile, langLock, shouldAbort, onSentence, heardAgent = null } = {}) {
    const machine = ensureState(profile);
    // lines the caller heard outside the brain (greeting, opening ladder, acks) join the turn history
    if (Array.isArray(heardAgent)) for (const l of heardAgent) if (l && String(l).trim()) V1.remember(machine, 'agent', String(l).trim());
    V1.remember(machine, 'caller', text);
    try {
      return await runBrainEngines({ text, profile: profile || {}, langLock, shouldAbort, onSentence, machine });
    } catch (err) {
      // B2 follow-up: a model, tool or turn error never loses the caller. Save the owner follow-up through the
      // callback commit path (once per call), then speak the v2 repair line. Never a booked line.
      const rec = await recordError(err, { profile, lastCaller: text });
      const lang = langLock === 'en' || langLock === 'sw' ? langLock : (machine.lang === 'sw' ? 'sw' : 'en');
      return { line: R.info({ kind: 'repair' }, lang), lang, end: false, path: 'brain_engines_error', repaired: 'throw', brainError: rec };
    }
  }

  /** Save this call's brain-error follow-up (idempotent per call). Never throws. */
  async function recordError(err, { profile = null, kind = null, lastCaller = null } = {}) {
    try {
      const machine = ensureState(profile || {});
      const log = typeof opts.log === 'function' ? opts.log : () => {};
      log(`[brain_engines] turn error: ${String((err && err.message) || err).slice(0, 160)}`);
      return await recordBrainError({
        machine,
        handlers: leadHandlers(machine, profile || {}, []),
        err,
        kind,
        callSid: opts.callSid || null,
        lastCaller,
        log,
        onRecord: typeof opts.onBrainError === 'function' ? opts.onBrainError : null,
        notify: opts.enginesNotify || null,
      });
    } catch (e) {
      return { ok: false, id: null, kind: kind || 'turn', error: String((e && e.message) || e).slice(0, 60), once: false };
    }
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
  function enginesCallIdResolver() {
    if (typeof opts.resolveCallId === 'function') return opts.resolveCallId;
    return async (sid) => { try { const db = require('../../db'); if (typeof db.getCall !== 'function') return null; const row = await db.getCall(sid); return (row && row.id) || null; } catch { return null; } };
  }
  function leadHandlers(machine, profile, log) {
    const h = createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: { tenantId: profile?.id || null, callSid: opts.callSid || null, callId: opts.callId || null, callerPhone: machine.callerPhone || null, recordWriteReceipt: opts.recordWriteReceipt, confirmCallerName: opts.confirmCallerName, resolveCallId: enginesCallIdResolver() } });
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

  async function runBrainEngines({ text, profile, langLock, shouldAbort, onSentence, machine }) {
    const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
    const sf = leadStreamFor();
    const ids = MS.resolveModelIds(env);
    const handlers = leadHandlers(machine, profile, []);
    const abort = typeof shouldAbort === 'function' ? shouldAbort : () => false;
    const r = await BE.runBrainEnginesTurn({
      text,
      profile,
      machine,
      env,
      streamFor: sf,
      modelId: ids.primary,
      langLock: langLock === 'en' || langLock === 'sw' ? langLock : null,
      shouldAbort: abort,
      onSentence,
      applyTools,
      handlers,
      opts: {
        ctx: { tenantId: profile?.id || null, callSid: opts.callSid || null, callId: opts.callId || null, callerPhone: machine.callerPhone || null },
        clock,
        now: nowFn,
        log: opts.log || (() => {}),
        // the owner alert rides on the saved row (executor); an extra escalation alert only when injected
        ...(opts.enginesNotify ? { notify: opts.enginesNotify } : {}),
        ...(opts.dispatchEscalationAlert ? { dispatch: opts.dispatchEscalationAlert } : {}),
        onModelStage: typeof opts.onModelStage === 'function' ? opts.onModelStage : null,
        traceTurnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex : null,
      },
    });
    // B2 follow-up: a failed write whose owner fallback also failed saved NOTHING for the owner. Report it once per
    // call through the same brain-error hook (Voice sends the direct owner alert when no summary will go out).
    if (r && r.write && r.write.status === 'failed_nothing_saved' && typeof opts.onBrainError === 'function') {
      const E = machine.eng || (machine.eng = {});
      if (!E.unsavedReported) {
        E.unsavedReported = true;
        try { opts.onBrainError({ ok: false, id: null, kind: 'write', error: String(r.write.error || 'write_failed').slice(0, 60), unsaved: true }); } catch { /* trace only */ }
      }
    }
    // end-call contract: same gate as every v2 path (never while a read-back or write is pending)
    const endCall = endDecision({ done: { end: r.end === true, endReason: r.reason || 'caller_done', toolResults: r.write && r.write.status !== 'committed' ? [{ ok: false }] : [] }, machine, profile, line: r.line, alreadyEnded: endSent });
    if (endCall.end) endSent = true;
    return { ...r, end: endCall.end, ...(endCall.end ? { reason: endCall.reason } : { reason: undefined }), ...(endCall.held ? { endHeld: endCall.held } : {}) };
  }

  /** Voice's unfinished hold: warm this turn's model call on the stable partial (BRAIN_V2_MODEL=on only). */
  function partial({ text, profile } = {}) {
    if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
    if (!modelRun || modelRun.mode !== 'on' || !modelRun.turnModel) return false;
    return !!modelRun.turnModel.partial({ text, profile: profile || {} });
  }
  // call start: prewarm the warm client before the first caller turn
  if (opts.prewarm !== false && env.GEMINI_API_KEY) TM.prewarm({ apiKey: env.GEMINI_API_KEY, modelId: MS.resolveModelIds(env).primary }).catch(() => {});
  if (opts.prewarm !== false && MS.modelMode(env) === 'on' && modelRun === undefined) modelRun = resolveModelShadow(opts, env);

  return { run, partial, recordError, getState: () => state, lastModelShadow: () => Promise.resolve(null) };
}


const AM = require('./audibleMouth');
const CP = require('./callPlan');
const ML = require('./modelLead');
const L2 = require('./lexicon');
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

