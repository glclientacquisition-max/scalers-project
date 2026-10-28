'use strict';
// Shared contract (Voice + Desk + Brain B1's brainModeAdapter), pure: no env, no DB, no requires.
// brainMode(tenant, { safeEnv }) -> { mode: 'full' | 'safe', reason: 'env' | 'owner' | 'admin' | 'default' }
//   'env'     BRAIN_SAFE_MODE=all (the server passes its value in; any case / spaces) wins over everything
//   'owner'   tenants.brain_mode = 'safe' set by the business (Desk Settings "Take messages only")
//   'admin'   tenants.brain_mode = 'safe' set by Super Admin, or with no recorded source
//   'default' the full KB brain (brain_mode 'full', or no column before kb_v2_brain_mode.sql .4)
//   'no_tenant' full, no tenant object at all (Brain B1's adapter contract)
// Facts: tenants.brain_mode / brain_mode_source (snake) or the profile's brainMode / brainModeSource (camel, strings).
// The only writer is public.set_brain_mode (docs/supabase/kb_v2_brain_mode.sql). Brain owns what safe mode says.
const BRAIN_MODES = Object.freeze(['full', 'safe']);

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
const pick = (o, snake, camel) => (o[snake] !== undefined ? o[snake] : o[camel]);

/** BRAIN_SAFE_MODE as the server passes it: 'all' = every business safe; unset / off / anything else = normal. */
function safeEnvAll(safeEnv) { return lower(safeEnv) === 'all'; }
/** For /healthz: how this server reads BRAIN_SAFE_MODE ('off' | 'all' | 'invalid' = a value that is ignored). */
function safeEnvState(safeEnv) {
  const v = lower(safeEnv);
  if (v === 'all') return 'all';
  return v === '' || /^(0|off|false|no|none)$/.test(v) ? 'off' : 'invalid';
}

function brainMode(tenant, { safeEnv } = {}) {
  if (safeEnvAll(safeEnv)) return { mode: 'safe', reason: 'env' };
  if (!tenant || typeof tenant !== 'object') return { mode: 'full', reason: 'no_tenant' };
  const raw = pick(tenant, 'brain_mode', 'brainMode');
  if (typeof raw === 'string' && lower(raw) === 'safe') {
    return { mode: 'safe', reason: lower(pick(tenant, 'brain_mode_source', 'brainModeSource')) === 'owner' ? 'owner' : 'admin' };
  }
  return { mode: 'full', reason: 'default' };
}

module.exports = { brainMode, safeEnvAll, safeEnvState, BRAIN_MODES };
