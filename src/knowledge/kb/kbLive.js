'use strict';
// Shared contract (Voice + Desk), pure: no env, no DB, no requires. The server passes the facts and env values in.
//
// Retire the old brain, step P1 (28 Oct, briefs/retire-old-brain-plan-2026-10-28.md): with BRAIN_KB_GATE on, the KB
// brain answers EVERY business. Readiness no longer picks a brain; isKbLive's `reason` is a quality signal only
// (Desk Fix card, Super Admin). brain_target 'v1' (held_v1) is gone. BRAIN_KB_GATE off stays the kill switch until
// P2 removes the switch (after Brain B2 deletes the old turn). The one per-call choice left is brainMode.
//
// Facts (public.tenants; owners/members read their own row, service role all):
//   kb_live_version   kb_snapshots.version callers hear (kb_publish_snapshot)
//   kb_ready_version  the snapshot version that passed readiness (kb_record_readiness on a pass)
//   brain_mode        'full' (default) | 'safe' = "Take messages only" (kb_v2_brain_mode.sql 2026-10-28.4)
//   brain_mode_source 'owner' (Desk Settings toggle) | 'admin' (Super Admin) | null; written only by set_brain_mode
// Camel keys are accepted too ({ version, readyVersion, brainMode, brainModeSource }, Voice's loadKbLive shape).
const ON = /^(1|true|on|yes)$/i;

/** Gate value as the server passes it: boolean, or the raw env string ('1' | 'true' | 'on' | 'yes', any case). */
function kbGateOn(gate) {
  if (typeof gate === 'boolean') return gate;
  return ON.test(String(gate == null ? '' : gate).trim());
}

const num = (v) => (v == null ? null : Number(v));
const pick = (o, snake, camel) => (o[snake] !== undefined ? o[snake] : o[camel]);

/** Readiness facts from a tenants row (snake) or Voice's loadKbLive result (camel). null when there are none. */
function kbLiveFacts(tenant) {
  if (!tenant || typeof tenant !== 'object') return null;
  const mode = String(pick(tenant, 'brain_mode', 'brainMode') || 'full').trim().toLowerCase();
  const src = String(pick(tenant, 'brain_mode_source', 'brainModeSource') || '').trim().toLowerCase();
  return {
    liveVersion: num(pick(tenant, 'kb_live_version', 'version')),
    readyVersion: num(pick(tenant, 'kb_ready_version', 'readyVersion')),
    brainMode: mode === 'safe' ? 'safe' : 'full',
    brainModeSource: src === 'owner' ? 'owner' : src === 'admin' ? 'admin' : null,
  };
}

/** Readiness / quality reason only (never a brain switch). */
function kbQuality(tenant) {
  const f = kbLiveFacts(tenant);
  if (!f) return 'no_facts';
  if (f.liveVersion == null || !Number.isFinite(f.liveVersion)) return 'no_live_version';
  if (f.readyVersion == null) return 'never_ready';
  if (!(f.readyVersion === f.liveVersion)) return 'ready_stale';
  return 'ready';
}

/**
 * isKbLive(tenant, { gate }) -> { live: boolean, reason }
 *   gate off:  { live: false, reason: 'gate_off' }  (kill switch until P2; Voice uses the env lists)
 *   gate on:   { live: true,  reason: <quality> }   for every business, ready or not:
 *     'no_facts' (no row / KB load failed: the brain degrades safely), 'no_live_version' (nothing published; the
 *     backfill publishes one for every business), 'never_ready' (setup gaps), 'ready_stale', 'ready'.
 */
function isKbLive(tenant, { gate } = {}) {
  if (!kbGateOn(gate)) return { live: false, reason: 'gate_off' };
  return { live: true, reason: kbQuality(tenant) };
}

/** BRAIN_SAFE_MODE as the server passes it: 'all' = every business safe; unset / off / anything else = normal. */
function safeEnvAll(safeEnv) { return String(safeEnv == null ? '' : safeEnv).trim().toLowerCase() === 'all'; }
/** For /healthz: how this server reads BRAIN_SAFE_MODE ('off' | 'all' | 'invalid' = a value that is ignored). */
function safeEnvState(safeEnv) {
  const v = String(safeEnv == null ? '' : safeEnv).trim().toLowerCase();
  if (v === 'all') return 'all';
  return v === '' || /^(0|off|false|no|none)$/.test(v) ? 'off' : 'invalid';
}

/**
 * brainMode(tenant, { safeEnv }) -> { mode: 'full' | 'safe', reason: 'env' | 'owner' | 'admin' | 'default' }
 *   'env'     BRAIN_SAFE_MODE=all wins (emergency brake, every business; env only, admin-owned)
 *   'owner'   tenants.brain_mode = 'safe' set by the business ("Take messages only" in Desk Settings)
 *   'admin'   tenants.brain_mode = 'safe' set by Super Admin (or with no recorded source)
 *   'default' the full KB brain (brain_mode 'full', no row, or no column before .4)
 * Brain owns what safe does (greet, take name / number / reason, read back, alert / hand over).
 */
function brainMode(tenant, { safeEnv } = {}) {
  if (safeEnvAll(safeEnv)) return { mode: 'safe', reason: 'env' };
  const f = kbLiveFacts(tenant);
  if (f && f.brainMode === 'safe') return { mode: 'safe', reason: f.brainModeSource === 'owner' ? 'owner' : 'admin' };
  return { mode: 'full', reason: 'default' };
}

/** Columns to select from public.tenants for isKbLive + brainMode (brain_mode / brain_mode_source need kb_v2_brain_mode.sql). */
const BRAIN_MODES = Object.freeze(['full', 'safe']);
const KB_LIVE_COLUMNS = 'kb_live_version, kb_ready_version, brain_mode, brain_mode_source';
const KB_LIVE_COLUMNS_PRE_BRAIN_MODE = 'kb_live_version, kb_ready_version';

module.exports = { isKbLive, kbQuality, brainMode, kbGateOn, kbLiveFacts, safeEnvAll, safeEnvState, KB_LIVE_COLUMNS, KB_LIVE_COLUMNS_PRE_BRAIN_MODE, BRAIN_MODES };
