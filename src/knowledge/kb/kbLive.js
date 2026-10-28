'use strict';
// isKbLive: the ONE rule for "this business's calls are answered from the v2 KB" (shared contract, Voice + Desk).
// Pure: no env, no DB, no requires. The caller passes the readiness facts and the gate value, like hashMode.
//
// Facts (all on public.tenants; owners/members read their own row under tenants_select_member, service role reads all):
//   kb_live_version   kb_snapshots.version callers hear (moved by kb_publish_snapshot)
//   kb_ready_version  the snapshot version that passed readiness (moved by kb_record_readiness on a pass)
//   brain_target      'v2' (default) = readiness decides; 'v1' = per-business hold on the old brain
// Camel keys are accepted too ({ version, readyVersion, brainTarget }, the shape Voice's loadKbLive returns).
//
// Gate: BRAIN_KB_GATE from the server that owns the decision (Voice: its env; Desk: its server env, never the client).
//   Off/unset = the kill switch: no business is on the KB, Voice falls back to the env lists.
//
// Rule (unchanged from kb/live.js isReady + decision): live = gate on AND brain_target != 'v1'
//   AND kb_live_version is set AND kb_ready_version === kb_live_version.
const ON = /^(1|true|on|yes)$/i;

/** Gate value as the server passes it: boolean, or the raw env string ('1' | 'true' | 'on' | 'yes', any case). */
function kbGateOn(gate) {
  if (typeof gate === 'boolean') return gate;
  return ON.test(String(gate == null ? '' : gate).trim());
}

// same coercion as the pre-contract kb/live.js isReady (Number(), exact brain_target match), so no decision moves
const num = (v) => (v == null ? null : Number(v));

/** Readiness facts from a tenants row (snake) or Voice's loadKbLive result (camel). null when there are none. */
function kbLiveFacts(tenant) {
  if (!tenant || typeof tenant !== 'object') return null;
  const pick = (snake, camel) => (tenant[snake] !== undefined ? tenant[snake] : tenant[camel]);
  return {
    liveVersion: num(pick('kb_live_version', 'version')),
    readyVersion: num(pick('kb_ready_version', 'readyVersion')),
    brainTarget: String(pick('brain_target', 'brainTarget') || 'v2'),
  };
}

/**
 * isKbLive(tenant, { gate }) -> { live: boolean, reason }
 * reason (first that applies): 'gate_off' | 'no_facts' | 'held_v1' | 'no_live_version' | 'never_ready' | 'ready_stale' | 'ready'
 *   gate_off         BRAIN_KB_GATE off: kill switch (Voice uses the env lists for every business)
 *   no_facts         no tenant row / readiness facts (Voice: profile not loaded or the KB load failed)
 *   held_v1          brain_target = 'v1' (Super Admin "Hold on old brain" / kb-cutover --hold)
 *   no_live_version  nothing published yet (kb_live_version null)
 *   never_ready      the live version has no readiness pass (kb_ready_version null)
 *   ready_stale      a newer live version has not passed readiness yet (kb_ready_version != kb_live_version)
 *   ready            on the KB
 */
function isKbLive(tenant, { gate } = {}) {
  if (!kbGateOn(gate)) return { live: false, reason: 'gate_off' };
  const f = kbLiveFacts(tenant);
  if (!f) return { live: false, reason: 'no_facts' };
  if (f.brainTarget !== 'v2') return { live: false, reason: 'held_v1' };
  if (f.liveVersion == null) return { live: false, reason: 'no_live_version' };
  if (f.readyVersion == null) return { live: false, reason: 'never_ready' };
  if (!(f.readyVersion === f.liveVersion)) return { live: false, reason: 'ready_stale' };
  return { live: true, reason: 'ready' };
}

/** Columns to select from public.tenants to call isKbLive. */
const KB_LIVE_COLUMNS = 'kb_live_version, kb_ready_version, brain_target';

module.exports = { isKbLive, kbGateOn, kbLiveFacts, KB_LIVE_COLUMNS };
