'use strict';
// BRAIN_V2_OWNS_CALL (default off): plan row C3, "v2 owns the call"
// (briefs/v2-greeting-and-path-plan.md). It only acts with BRAIN_V2=on and
// BRAIN_V2_MODE=live. In that mode v2 is the only owner of a caller turn:
//   - a v2 error, an exception or an empty line speaks the v2 repair template
//     (EN/SW). It never falls through to a v1 local or Gemini turn;
//   - v2 writes go straight to the tool executor. There is no ensureRequired*
//     and no guardToolPlan, and the v1 caller-file speech gate does not edit
//     v2 lines. BRAIN_V2_COMMIT_SAFETY (C1) is the guard, and this flag turns
//     it on too (commitSafety.commitSafetyEnabled);
//   - once v2 has ended the call, no turn opens again, not even on a media
//     reconnect for the same call;
//   - machine.finishCall runs once per call at hangup. A reconnect, a double
//     hangup or a second terminal webhook gets the cached result back.
// Off: nothing here is called; server.js keeps the #849 behaviour.
const R = require('./receipts');
const { finishCall } = require('./machine');

const ON = /^(1|true|on|yes)$/i;
function ownsCallEnabled(env = null) {
  return ON.test(String((env ? env.BRAIN_V2_OWNS_CALL : process.env.BRAIN_V2_OWNS_CALL) || ''));
}

function repairLine(lang) {
  return R.info({ kind: 'repair' }, lang === 'sw' ? 'sw' : 'en');
}

// One owned v2 turn. Never throws and never returns an empty line.
async function runOwnedTurn(live, input = {}, { log = () => {} } = {}) {
  const lang = () => {
    const st = live && typeof live.getState === 'function' ? live.getState() : null;
    return input.langLock || (st && st.lang) || 'en';
  };
  try {
    const r = await live.run(input);
    if (r && String(r.line || '').trim()) return { ...r, owned: true };
    log(`brain_v2_owned repair reason=${r ? 'empty_line' : 'no_result'}`);
    return { line: repairLine(lang()), lang: lang(), end: false, owned: true, repaired: r ? 'empty_line' : 'no_result' };
  } catch (err) {
    log(`brain_v2_owned repair reason=throw err=${String(err && err.message ? err.message : err).slice(0, 160)}`);
    return { line: repairLine(lang()), lang: lang(), end: false, owned: true, repaired: 'throw' };
  }
}

// Per-process registry: the call's v2 live runner, whether v2 ended it, and its
// one finishCall result. Keyed by call sid, so a reconnecting media session
// for the same call reuses the same state.
function createOwnedCalls({ maxFinished = 5000 } = {}) {
  const lives = new Map();
  const ended = new Map();
  const finished = new Map();
  const metas = new Map();
  let finishRuns = 0;
  function remember(map, key, value) {
    map.set(key, value);
    if (map.size > maxFinished) map.delete(map.keys().next().value);
  }
  return {
    live(callSid, make, meta = {}) {
      if (!lives.has(callSid)) lives.set(callSid, make());
      metas.set(callSid, { ...(metas.get(callSid) || {}), ...meta });
      return lives.get(callSid);
    },
    meta: (callSid) => metas.get(callSid) || {},
    getLive: (callSid) => lives.get(callSid) || null,
    markEnded(callSid, reason) { if (!ended.has(callSid)) remember(ended, callSid, { reason: reason || 'v2_end', at: Date.now() }); },
    ended: (callSid) => ended.get(callSid) || null,
    // Exactly once per call sid. Later calls (reconnect, double hangup, a second
    // terminal webhook) return the first result with once: false.
    finish(callSid, args = {}) {
      if (finished.has(callSid)) return { ...finished.get(callSid), once: false };
      const live = lives.get(callSid);
      const state = live && typeof live.getState === 'function' ? live.getState() : null;
      if (!state || !(state.turn > 0)) return null;
      let fin;
      try {
        fin = finishCall(state, { businessName: args.businessName || '', callerPhone: args.callerPhone || null, profile: args.profile || null });
      } catch (err) {
        fin = { outcome: 'finish_failed', error: String(err && err.message ? err.message : err).slice(0, 200) };
      }
      finishRuns += 1;
      const out = {
        ...fin,
        lang: state.lang || 'en',
        name: (state.slots && state.slots.name) || null,
        writeReceipts: (Array.isArray(state.writeReceipts) ? state.writeReceipts : []).map((r) => ({ phase: r.phase, tool: r.tool, idempotencyKey: r.idempotencyKey || null, reason: r.reason || null })),
        endedByV2: ended.has(callSid),
      };
      remember(finished, callSid, out);
      lives.delete(callSid);
      metas.delete(callSid);
      return { ...out, once: true };
    },
    finished: (callSid) => finished.get(callSid) || null,
    forget(callSid) { lives.delete(callSid); metas.delete(callSid); },
    stats: () => ({ lives: lives.size, finished: finished.size, finishRuns }),
  };
}

// A short, typed patch for calls.summary meta: what v2 decided and wrote.
function summaryPatch(fin) {
  if (!fin) return null;
  return {
    brain_v2: {
      outcome: fin.outcome || null,
      owner_text: fin.ownerText || null,
      ended_by_v2: Boolean(fin.endedByV2),
      write_receipts: fin.writeReceipts || [],
      ...(Array.isArray(fin.summaryReceipts) ? { summary_receipts: fin.summaryReceipts } : {}),
    },
  };
}

// A4 seam (CALL_SUMMARY_EVENT): where the owner summary gets its v2 receipts.
// Reads the cached once-only finish result; it never runs finishCall itself.
//   finished: v2 owned the call and finishCall ran (fin carries summaryReceipts);
//   pending:  v2 owns a live call whose finish waits out the reconnect window,
//             so the summary waits for that one finish;
//   none:     v2 does not own this call (flag off or no owned turn): v1 receipts.
function a4V2Source(owned, callSid, { ownsCallOn = ownsCallEnabled() } = {}) {
  if (!ownsCallOn || !owned || !callSid) return { state: 'none', fin: null };
  const fin = owned.finished(callSid);
  if (fin) return { state: 'finished', fin };
  if (owned.getLive(callSid)) return { state: 'pending', fin: null };
  return { state: 'none', fin: null };
}

module.exports = { ownsCallEnabled, repairLine, runOwnedTurn, createOwnedCalls, summaryPatch, a4V2Source };
