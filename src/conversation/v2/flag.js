'use strict';
// BRAIN_V2 flags. All off by default.
//   BRAIN_V2=1           v2 Brain on (BRAIN_V2_MODE=shadow|live, default shadow: compute, do not act)
//   BRAIN_V2_SHADOW=1    Voice runs the v2 shadow beside today's Brain (log-only, never speaks/writes)
//   BRAIN_V2_TENANTS     optional comma-separated tenant-id allowlist for BOTH flags. Default empty
//                        (unset) = no tenant restriction, same as Voice's v2Shadow.js. Set it to
//                        one id (Done & Dusted on staging) to scope the shadow to that tenant only.
const ON = /^(1|true|on|yes)$/i;
function tenantAllowlist(env = process.env) {
  return String(env.BRAIN_V2_TENANTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
//   BRAIN_KB_GATE=on     v2 KB readiness picks the brain per business (tenants.brain_target + kb_ready_version);
//                        BRAIN_V2_TENANTS and BRAIN_V1_DRAFT_TENANTS are ignored. Off/unset = the env lists (kill switch).
function tenantAllowed({ env = process.env, tenantId } = {}) {
  const gate = require('../../knowledge/kb/live').decision({ env, tenantId });
  if (gate !== null) return gate;
  const allow = tenantAllowlist(env);
  if (!allow.length) return true;
  return tenantId != null && allow.includes(String(tenantId).trim().toLowerCase());
}
function brainV2Enabled({ env = process.env, tenantId } = {}) {
  if (!ON.test(String(env.BRAIN_V2 || ''))) return false;
  return tenantAllowed({ env, tenantId });
}
function brainV2ShadowEnabled({ env = process.env, tenantId } = {}) {
  if (!ON.test(String(env.BRAIN_V2_SHADOW || ''))) return false;
  return tenantAllowed({ env, tenantId });
}
function brainV2Mode({ env = process.env } = {}) { return /^live$/i.test(String(env.BRAIN_V2_MODE || '')) ? 'live' : 'shadow'; }
/** BRAIN_ENGINES (off): three-engine v2 stack (understanding, response, handoff). Off = unchanged paths. */
function brainEnginesOn({ env = process.env, tenantId } = {}) {
  if (!ON.test(String(env.BRAIN_ENGINES || 'off'))) return false;
  return tenantAllowed({ env, tenantId });
}
module.exports = { brainV2Enabled, brainV2ShadowEnabled, brainV2Mode, tenantAllowlist, tenantAllowed, brainEnginesOn };
