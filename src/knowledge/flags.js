'use strict';
// VOICE_LOOKUPS and VOICE_LOOKUP_TOOL. Default off.
// A comma list of kinds (price, fee, hours, pay, services), or on/all for every kind.
// Nothing here reads a tenant row or speaks.

const ON = /^(1|true|on|yes)$/i;
const KINDS = ['price', 'fee', 'hours', 'pay', 'services'];
const ALIAS = { area_fee: 'fee', coverage: 'fee', area: 'fee' };

function readEnv(name, env) {
  if (env && Object.prototype.hasOwnProperty.call(env, name)) return env[name];
  // Literal process.env reads so docs/reference/env.md picks the names up.
  if (name === 'VOICE_LOOKUPS') return process.env.VOICE_LOOKUPS;
  if (name === 'VOICE_LOOKUP_TOOL') return process.env.VOICE_LOOKUP_TOOL;
  if (name === 'VOICE_PERSONA_ONLY_PROMPT') return process.env.VOICE_PERSONA_ONLY_PROMPT;
  return '';
}

/** @returns {Set<string>} enabled lookup kinds. Empty when the flag is off. */
function enabledKinds(env) {
  const raw = String(readEnv('VOICE_LOOKUPS', env) || '').trim();
  if (!raw || /^(0|false|off|no)$/i.test(raw)) return new Set();
  if (ON.test(raw) || /^all$/i.test(raw)) return new Set(KINDS);
  const set = new Set();
  for (const part of raw.split(',')) {
    const key = ALIAS[part.trim().toLowerCase()] || part.trim().toLowerCase();
    if (KINDS.includes(key)) set.add(key);
  }
  return set;
}

function kindEnabled(kind, env) {
  const key = ALIAS[String(kind || '').toLowerCase()] || String(kind || '').toLowerCase();
  return enabledKinds(env).has(key);
}

/** Gemini `lookup` function tool. Default off. */
function lookupToolEnabled(env) {
  return ON.test(String(readEnv('VOICE_LOOKUP_TOOL', env) || '').trim());
}

/** Strip fact sections from the Desk-compiled prompt at load. Default off. */
function personaOnlyFlag(env) {
  return ON.test(String(readEnv('VOICE_PERSONA_ONLY_PROMPT', env) || '').trim());
}

/** True when any lookup kind or the lookup tool is on. Guard changes key off this. */
function anyLookupOn(env) {
  return enabledKinds(env).size > 0 || lookupToolEnabled(env);
}

module.exports = {
  KINDS,
  enabledKinds,
  kindEnabled,
  lookupToolEnabled,
  personaOnlyFlag,
  anyLookupOn,
};
