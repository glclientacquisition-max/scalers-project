'use strict';
// BRAIN_ENGINES per-turn trace: ONE structured record per turn. Goes to machine.trace and to the existing
// voice trace path (opts.onModelStage -> voiceTrace.noteBrainV2Model -> voice_turn_traces stages), so no
// new table. Never throws. Names are kept out (slot presence only); voiceTrace redacts phone digits.
function slotPresence(slots = {}) {
  const out = {};
  for (const [k, v] of Object.entries(slots || {})) {
    if (k === 'name') out.name = v ? 'given' : null;
    else out[k] = v == null ? null : v;
  }
  return out;
}

function buildTrace({ turn, turnIndex, u, lang, goal, write, guard, dropped, filler, timings, stripped, path, mode = null, degraded = [] }) {
  const p = goal && goal.p;
  const safe = !!(mode && mode.mode === 'safe');
  return {
    kind: 'brain_engines',
    stage: 'brain_engines',
    // B1: which brain answered this turn. brain_stage: 'full' | 'degraded' (a named rule fired) | 'safe';
    // brain_mode_reason: 'owner' | 'admin' | 'env' in safe mode ('default' when full); degraded: the rule names
    brain_stage: safe ? 'safe' : (degraded && degraded.length ? 'degraded' : 'full'),
    brain_mode: safe ? 'safe' : 'full',
    brain_mode_reason: (mode && mode.reason) || 'default',
    degraded: degraded && degraded.length ? [...degraded] : [],
    turn,
    turnIndex: turnIndex ?? null,
    path,
    understanding: u ? { intent: u.intent, answers: u.answers || [], yes_no: u.yes_no ?? null, slots: slotPresence(u.slots), language: u.language || null, source: u.source || null, fallbackReason: u.fallbackReason || null, outcome: u._outcome || null } : null,
    lang,
    goal: goal ? { type: goal.type, slot: goal.slot || null, why: goal.why || null, corrected: !!goal.corrected } : null,
    tool: p ? { name: p.tool, slotsHash: (() => { try { return require('./commitSafety').slotHash(p); } catch { return null; } })(), idempotencyKey: p.idemKey || null } : null,
    write: write || null,
    guard: guard || [],
    dropped: dropped || [],
    filler: filler || null,
    timings: timings || {},
    stripped: stripped && stripped.length ? stripped : undefined,
  };
}

function emitTrace(rec, { machine, onStage, log } = {}) {
  try { (machine.trace || (machine.trace = [])).push({ turn: rec.turn, brain_engines: rec }); } catch { /* never throws */ }
  try { if (typeof onStage === 'function') onStage(rec); } catch (e) { try { (log || (() => {}))(`[brain_engines] trace sink failed: ${e?.message || e}`); } catch { /* */ } }
  return rec;
}

module.exports = { buildTrace, emitTrace, slotPresence };
