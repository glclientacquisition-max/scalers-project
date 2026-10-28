'use strict';
// Which brain mode this call runs in: 'full' (the engines + KB, default) or 'safe' (the emergency capture-only
// script, ./safeMode.js). Decided ONCE per call (first engines turn) and pinned on the call state, like profile.kb.
//
// The decision is Platform's shared contract, src/knowledge/kb/brainMode.js (Voice, Desk and Brain read the same
// function): brainMode(tenant, { safeEnv }) -> { mode: 'full' | 'safe', reason: 'env' | 'owner' | 'admin' |
// 'default' | 'no_tenant' }. Pure: no env, no DB. Sources: tenants.brain_mode / brain_mode_source (on the profile as
// the plain strings profile.brainMode / profile.brainModeSource) and the global BRAIN_SAFE_MODE value passed in
// (unset / off = normal, 'all' = every business). Safe mode is only ever switched on by hand, never automatically:
// by the owner (Desk Settings, "Take messages only"), by Super Admin, or by the env brake.
// profile.brainModeDecision (kb/live.attach) is the same decision made at profile load; this adapter recomputes it
// from the plain strings with the env the brain runs under, so a test or replay env is honoured.
// B2: the local stand-in that preceded Platform P1 is gone; anything unexpected still reads 'full', never throws.
const { brainMode: platformBrainMode } = require('../../knowledge/kb/brainMode');

const MODES = new Set(['full', 'safe']);

/** brainMode(tenant, { safeEnv }) -> { mode, reason }. Never throws; anything unexpected reads 'full'. */
function brainMode(tenant, { safeEnv } = {}) {
  try {
    const r = platformBrainMode(tenant, { safeEnv });
    if (r && MODES.has(r.mode)) return { mode: r.mode, reason: r.reason || null };
  } catch { /* fall through */ }
  return { mode: 'full', reason: 'error' };
}

/** The call's mode, decided on its first engines turn and pinned on the call state for the whole call. */
function callMode(machine, profile, env = process.env) {
  if (machine && machine.brainMode && MODES.has(machine.brainMode.mode)) return machine.brainMode;
  const r = brainMode(profile, { safeEnv: env ? env.BRAIN_SAFE_MODE : undefined });
  if (machine) machine.brainMode = r;
  return r;
}

module.exports = { brainMode, callMode, usingPlatform: () => true };
