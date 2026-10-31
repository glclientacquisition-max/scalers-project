'use strict';
// B1: which brain mode this call runs in: 'full' (the engines + KB, default) or 'safe' (the emergency capture-only
// script, ./safeMode.js). Decided ONCE per call (first engines turn) and pinned on the call state, like profile.kb.
//
// Contract (agreed with Platform, plan §2d): brainMode(tenant, { safeEnv }) -> { mode: 'full' | 'safe', reason }.
// Pure: no env, no DB. Sources: tenants.brain_mode ('full' default | 'safe') and the global BRAIN_SAFE_MODE value the
// server passes in (unset / off = normal, 'all' = every business). Safe mode is only ever switched on by hand, never
// automatically: by the owner (Desk Settings, "Take messages only"), by Super Admin, or by the env brake.
// reason (Alvin, 28 Oct): 'owner' | 'admin' | 'env' when safe; 'default' when full. Who set brain_mode comes from
// tenants.brain_mode_source ('owner' | 'admin'; Platform P1 names the column, an unknown value reads 'admin').
//
// TODO(platform P1): Platform ships brainMode() in src/knowledge/kb/ next to isKbLive. When that module exists it
// is used as is; the local stand-in below (same signature, same sources) is then deleted. Swap = delete
// `localBrainMode` and the try/require fallback. Until P1's SQL adds tenants.brain_mode and the profile select, no
// profile carries brain_mode, so only BRAIN_SAFE_MODE=all (not set anywhere) can turn safe mode on: default full.
const MODES = new Set(['full', 'safe']);

function localBrainMode(tenant, { safeEnv } = {}) {
  const env = String(safeEnv == null ? '' : safeEnv).trim().toLowerCase();
  if (env === 'all') return { mode: 'safe', reason: 'env' };
  if (!tenant || typeof tenant !== 'object') return { mode: 'full', reason: 'no_tenant' };
  const raw = tenant.brain_mode !== undefined ? tenant.brain_mode : tenant.brainMode;
  const m = String(raw == null ? '' : raw).trim().toLowerCase();
  if (m === 'safe') {
    const src = String((tenant.brain_mode_source !== undefined ? tenant.brain_mode_source : tenant.brainModeSource) || '').trim().toLowerCase();
    return { mode: 'safe', reason: src === 'owner' ? 'owner' : 'admin' };
  }
  return { mode: 'full', reason: 'default' };
}

let platformBrainMode = null;
try {
  // eslint-disable-next-line global-require
  const mod = require('../../knowledge/kb/brainMode');
  if (mod && typeof mod.brainMode === 'function') platformBrainMode = mod.brainMode;
} catch { platformBrainMode = null; }

/** brainMode(tenant, { safeEnv }) -> { mode, reason }. Never throws; anything unexpected reads 'full'. */
function brainMode(tenant, { safeEnv } = {}) {
  try {
    const r = (platformBrainMode || localBrainMode)(tenant, { safeEnv });
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

module.exports = { brainMode, callMode, localBrainMode, usingPlatform: () => !!platformBrainMode };
