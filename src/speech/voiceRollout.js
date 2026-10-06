// Per-tenant voice rollout. Empty VOICE_ROLLOUT_TENANTS keeps the
// existing auto rules (staging and local on, production off).
// A non-empty list is the tenant flag: only those ids get the
// structured mouth and the trace, including in production.
// No new SQL. Platform owns the tenant row.

function rolloutTenantIds(env = process.env) {
  return String(env.VOICE_ROLLOUT_TENANTS || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * null: the allowlist is empty, so the caller keeps its auto/on/off rule.
 * true/false: a list is set, and this tenant is in it or not.
 * A missing tenant id with a non-empty list is off.
 */
function rolloutAllows(tenantId, env = process.env) {
  const list = rolloutTenantIds(env);
  if (!list.length) return null;
  const id = tenantId == null ? '' : String(tenantId).trim();
  if (!id) return false;
  return list.includes(id);
}

module.exports = {
  rolloutTenantIds,
  rolloutAllows,
};
