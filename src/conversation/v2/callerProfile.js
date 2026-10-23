'use strict';
// Caller profile v1 (#871 / CALLER_PROFILE_SPEC.md). Flag off by default: no behaviour change.
// GO also named this BRAIN_CALLER_PROFILE; canonical flag is BRAIN_V2_CALLER_PROFILE (off|shadow|on).
// Reads: gated tools return not_bound until nameConfirmed. Writes: post-call ProfileWriter only.
// Live booking/cancel commits stay on the C1 path. Built in our Supabase (not Zep/mem0).

const ON = /^(1|true|on|yes|shadow)$/i;
const FLAG_NAME = 'BRAIN_V2_CALLER_PROFILE';
const FLAG_ALIAS = 'BRAIN_CALLER_PROFILE';
void process.env.BRAIN_V2_CALLER_PROFILE;
void process.env.BRAIN_CALLER_PROFILE;

function rawFlag(env = process.env) {
  const e = env || process.env;
  const v = e[FLAG_NAME] != null && String(e[FLAG_NAME]).trim() !== ''
    ? e[FLAG_NAME]
    : e[FLAG_ALIAS];
  return String(v == null ? '' : v).trim().toLowerCase();
}

/** @returns {'off'|'shadow'|'on'} */
function callerProfileMode(env = process.env) {
  const v = rawFlag(env);
  if (v === 'shadow') return 'shadow';
  if (/^(1|true|on|yes)$/i.test(v)) return 'on';
  return 'off';
}

function callerProfileEnabled(env = process.env) {
  return callerProfileMode(env) !== 'off';
}

function callerProfileLive(env = process.env) {
  return callerProfileMode(env) === 'on';
}

/** Tool gate: bind only after name confirmed (and person picked on shared lines later). */
function bindState({ nameConfirmed, personId, lineShared } = {}) {
  if (!nameConfirmed) return 'unbound';
  if (lineShared && !personId) return 'candidate';
  return 'bound';
}

/**
 * Stub reader for get_caller_profile. Flag off → disabled. Unbound → not_bound.
 * No DB I/O in this stub (prefetch/RPC land in a later slice).
 */
function getCallerProfile({ env = process.env, nameConfirmed, personId, lineShared, card } = {}) {
  if (!callerProfileEnabled(env)) return { error: 'disabled', mode: 'off' };
  const bind = bindState({ nameConfirmed, personId, lineShared });
  if (bind !== 'bound') return { error: 'not_bound', bind_state: bind };
  if (callerProfileMode(env) === 'shadow') {
    return { ok: true, mode: 'shadow', bind_state: bind, card: card || null, inject: false };
  }
  return { ok: true, mode: 'on', bind_state: bind, card: card || null, inject: true };
}

/**
 * Stub reader for get_caller_history (scoped open_items|visits|preferences|property).
 * Same bind gate as get_caller_profile.
 */
function getCallerHistory({
  env = process.env,
  nameConfirmed,
  personId,
  lineShared,
  scope = 'open_items',
  items,
} = {}) {
  if (!callerProfileEnabled(env)) return { error: 'disabled', mode: 'off' };
  const bind = bindState({ nameConfirmed, personId, lineShared });
  if (bind !== 'bound') return { error: 'not_bound', bind_state: bind };
  const allowed = new Set(['open_items', 'visits', 'preferences', 'property']);
  if (!allowed.has(String(scope || ''))) return { error: 'bad_scope', scope };
  if (callerProfileMode(env) === 'shadow') {
    return { ok: true, mode: 'shadow', bind_state: bind, scope, items: items || [], inject: false };
  }
  return { ok: true, mode: 'on', bind_state: bind, scope, items: items || [], inject: true };
}

module.exports = {
  FLAG_NAME,
  FLAG_ALIAS,
  callerProfileMode,
  callerProfileEnabled,
  callerProfileLive,
  bindState,
  getCallerProfile,
  getCallerHistory,
};
