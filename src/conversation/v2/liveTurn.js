'use strict';
// Live BA v2 turn. BRAIN_V2=on and BRAIN_V2_MODE=live. Speaks receipt
// sentences. Writes go through createLiveHandlers. Flag off = unused.

const { brainV2Enabled, brainV2Mode } = require('./flag');
const { createState } = require('./machine');
const { runTurnStream } = require('./stream');
const { createLiveHandlers } = require('./liveHandlers');
const { createClassifyAsk } = require('./classifyAsk');
const { createGeminiSend, createGeminiStreamModel } = require('./transport');
const MS = require('./modelShadow');

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
  return { mode, shadow, model, backupModel, modelId: ids.primary, backupModelId: ids.backup };
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

  async function run({ text, profile, langLock, shouldAbort } = {}) {
    if (!brainV2Enabled({ env, tenantId: profile?.id }) || brainV2Mode({ env }) !== 'live') {
      return null;
    }
    const machine = ensureState(profile);
    const handlers = createLiveHandlers({ applyTools: applyTools || (async () => ({ results: [] })), ctx: { tenantId: profile?.id || null, callSid: opts.callSid || null, callId: opts.callId || null, callerPhone: machine.callerPhone || null, recordWriteReceipt: opts.recordWriteReceipt, confirmCallerName: opts.confirmCallerName } });
    const sentences = [];
    let done = null;
    if (modelRun === undefined) modelRun = resolveModelShadow(opts, env);
    // shadow: snapshot before the rules turn; the model call starts now and is never awaited here
    const finishShadow = modelRun ? modelRun.shadow.begin({ text, state: machine, profile: profile || {}, turnIndex: typeof opts.traceTurnIndex === 'function' ? opts.traceTurnIndex() : null, openRows: machine.file?.openRows || [] }) : null;
    const it = runTurnStream(machine, {
      text,
      profile: { ...(profile || {}) },
      now: nowFn(),
      handlers,
      model: opts.model || (modelRun && modelRun.mode === 'on' ? async ({ request }) => MS.cappedCascade({ primary: modelRun.model, backup: modelRun.backupModel, request, primaryId: modelRun.modelId || MS.MODEL_ID, backupId: modelRun.backupModelId || MS.MODEL_BACKUP_ID }) : null),
      classify: defaultClassify(opts),
      langLock: langLock === 'en' || langLock === 'sw' ? langLock : null,
      shouldAbort: typeof shouldAbort === 'function' ? shouldAbort : () => false,
    });
    for await (const ev of it) {
      if (!ev) continue;
      if (ev.type === 'sentence') sentences.push({ text: ev.text, lang: ev.lang });
      if (ev.type === 'done') done = ev;
    }
    if (finishShadow) lastShadow = finishShadow(machine, done); // compared and logged off the critical path
    const line = sentences.map((s) => s.text).join(' ').trim() || String(done?.line || '').trim();
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
    };
  }

  return { run, getState: () => state, lastModelShadow: () => lastShadow };
}


const AM = require('./audibleMouth');

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

