'use strict';
// Synthetic BRAIN_ENGINES call harness: drives createBrainV2Live (flag on) with stand-in models.
// No network, no Gemini key, no prod data: every caller turn is a scripted synthetic line.
const { createBrainV2Live } = require('../../src/conversation/v2/liveTurn');
const { tenantProfileFromRow } = require('../../src/tenantProfile');
const { indexFieldMeta } = require('../../src/conversation/provenance');
const FR = require('../fixtures/dndSimTenant.json');

const inner = FR.picks.picks;
const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
const PROFILE = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };
PROFILE.teamDirectory = [{ name: 'Owner', role: 'owner', phone: '+254711000001', receives_escalation: true }];

const ENV = {
  BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on',
  BRAIN_MODEL_LEAD: 'on', BRAIN_ENGINES: '1',
};
const CALLER = '+254700000123';

function U(over = {}) {
  return { intent: 'unknown', answers: [], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false, ...over };
}

/**
 * script: [{ say, u, reply }] — u = the stand-in understanding JSON (null = model fails -> rules fallback),
 * reply = the stand-in reply model text (string) or null (reply model fails).
 * write: (payload, n) => applyTools result for writes (default: ok with a row id).
 */
function makeCall({ now = '2026-10-25T19:50:00+03:00', env = {}, write, understandDelayMs = 0, replyDelayMs = 0, callerFile = {}, onModelStage, dispatch, resolveCallId } = {}) {
  const calls = { understand: 0, reply: 0, models: [] };
  const writes = []; const receipts = []; const notifies = []; const traces = []; const heard = [];
  let turn = -1; let script = [];
  const stream = (modelId) => async ({ request, signal }) => {
    calls.models.push(modelId);
    const sys = request.systemInstruction?.parts?.[0]?.text || '';
    const s = script[turn] || {};
    if (/Read ONE caller turn/.test(sys)) {
      calls.understand += 1;
      const ud = typeof understandDelayMs === 'function' ? understandDelayMs() : understandDelayMs;
      if (ud) await new Promise((r, rej) => { const t = setTimeout(r, ud); signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
      if (s.u === null) throw new Error('stand-in understanding failure');
      return { text: JSON.stringify(s.u || U()) };
    }
    calls.reply += 1;
    const rd = typeof replyDelayMs === 'function' ? replyDelayMs() : replyDelayMs;
    if (rd) await new Promise((r) => setTimeout(r, rd));
    if (s.reply === null) throw new Error('stand-in reply failure');
    return { text: JSON.stringify({ reply: s.reply || '' }) };
  };
  let n = 0;
  const applyTools = async (payload) => {
    n += 1;
    const kind = payload.appointment ? 'create_appointment' : payload.serviceRequest ? 'create_service_request' : payload.escalate ? 'escalate' : payload.saveCallerInfo ? 'save_caller_info' : 'other';
    if (kind === 'save_caller_info' || kind === 'other') return { results: [] };
    writes.push({ kind, args: payload.appointment || payload.serviceRequest || payload.escalate });
    if (write) return write(payload, writes.length, kind);
    return { results: [{ action: kind, status: 'succeeded', id: `row-${writes.length}` }] };
  };
  const live = createBrainV2Live({
    env: { ...ENV, ...env },
    applyTools,
    modelLeadStreamFor: stream,
    v1DraftStreamFor: stream,
    prewarm: false,
    now: () => new Date(typeof now === 'function' ? now() : now),
    callSid: 'HD_synthetic0001',
    callerFile: { callerPhone: CALLER, contactName: null, openRows: [], ...callerFile },
    log: () => {},
    recordWriteReceipt: async (r) => { receipts.push(r); return { ok: true, id: `rcpt-${receipts.length}` }; },
    confirmCallerName: async () => ({ ok: true }),
    onModelStage: (rec) => { traces.push(rec); if (onModelStage) onModelStage(rec); },
    traceTurnIndex: () => turn,
    ...(dispatch ? { dispatchEscalationAlert: async (a) => { notifies.push(a); return dispatch(a); } } : {}),
    resolveCallId: resolveCallId || (async () => '11111111-2222-4333-8444-555555555555'),
  });
  async function say(step, { langLock = null } = {}) {
    script.push(step); turn += 1;
    const streamed = [];
    const t0 = Date.now(); let firstAt = null;
    const r = await live.run({ text: step.say, profile: PROFILE, langLock, onSentence: (s) => { if (firstAt === null) firstAt = Date.now() - t0; streamed.push(s); } });
    r.firstSoundMs = firstAt; r.wallMs = Date.now() - t0;
    heard.push({ caller: step.say, agent: r.line, lang: r.lang, path: r.path });
    return { ...r, streamed };
  }
  return { say, calls, writes, receipts, notifies, traces, heard, live, profile: PROFILE };
}

module.exports = { makeCall, U, PROFILE, ENV, CALLER };
