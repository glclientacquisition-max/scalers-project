'use strict';
// BRAIN_V2 flag. Off by default. Optional per-tenant allowlist: BRAIN_V2_TENANTS=id1,id2.
// BRAIN_V2_MODE=shadow|live (default shadow: compute v2 turn, do not act).
const ON = /^(1|true|on|yes)$/i;
function brainV2Enabled({ env = process.env, tenantId } = {}) {
  if (!ON.test(String(env.BRAIN_V2 || ''))) return false;
  const allow = String(env.BRAIN_V2_TENANTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(String(tenantId || ''))) return false;
  return true;
}
function brainV2Mode({ env = process.env } = {}) { return /^live$/i.test(String(env.BRAIN_V2_MODE || '')) ? 'live' : 'shadow'; }
module.exports = { brainV2Enabled, brainV2Mode };
