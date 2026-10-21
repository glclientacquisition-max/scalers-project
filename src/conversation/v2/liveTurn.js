'use strict';
// Live BA v2 turn. BRAIN_V2=on and BRAIN_V2_MODE=live. Speaks receipt
// sentences. Writes go through createLiveHandlers. Flag off = unused.

const { brainV2Enabled, brainV2Mode } = require('./flag');
const { createState } = require('./machine');
const { runTurnStream } = require('./stream');
const { createLiveHandlers } = require('./liveHandlers');
const { createClassifyAsk } = require('./classifyAsk');
const { createGeminiSend } = require('./transport');

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
    contactName: file.contactName || null,
    openRows,
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
  let state = null;
  let endSent = false;

  function ensureState(profile) {
    if (state) return state;
    const file = callerFile(opts);
    state = createState({
      profile: profile || {},
      callerPhone: file.callerPhone,
      contactName: file.contactName,
      openRows: file.openRows,
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
    const it = runTurnStream(machine, {
      text,
      profile: { ...(profile || {}) },
      now: new Date(),
      handlers,
      model: opts.model || null,
      classify: defaultClassify(opts),
      langLock: langLock === 'en' || langLock === 'sw' ? langLock : null,
      shouldAbort: typeof shouldAbort === 'function' ? shouldAbort : () => false,
    });
    for await (const ev of it) {
      if (!ev) continue;
      if (ev.type === 'sentence') sentences.push({ text: ev.text, lang: ev.lang });
      if (ev.type === 'done') done = ev;
    }
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

  return { run, getState: () => state };
}

module.exports = { createBrainV2Live, callerFile, endDecision };
