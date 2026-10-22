/**
 * POST body for the Super Admin live-tenant route.
 * confirm must be the boolean true. A blank reason is refused.
 * @param {unknown} body
 * @returns {string | null}
 */
function liveTenantPostError(body) {
  if (!body || typeof body !== "object") return "confirm";
  const posted = /** @type {{ confirm?: unknown, reason?: unknown, tenantId?: unknown, enabled?: unknown }} */ (body);
  if (posted.confirm !== true) return "confirm";
  if (typeof posted.reason !== "string" || posted.reason.trim() === "") return "reason";
  if (typeof posted.tenantId !== "string" || posted.tenantId.trim() === "") return "tenant";
  if (typeof posted.enabled !== "boolean") return "enabled";
  return null;
}

module.exports = { liveTenantPostError };
