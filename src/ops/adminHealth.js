// GET /admin/health auth + key-scope pass/fail. The token is a separate,
// rotatable read-only secret (ADMIN_HEALTH_TOKEN), called only from the
// Next server. Scope results are names + booleans, never key values.

const crypto = require('crypto');

const REQUIRED_SAUTIKIT_SCOPES = [
  'wallet.read',
  'numbers.read',
  'calls.read',
  'recordings.read',
  'whatsapp.messages',
];

/** @returns {'ok'|'unauthorized'|'not_configured'} */
function checkAdminHealthAuth(headers = {}) {
  const token = String(process.env.ADMIN_HEALTH_TOKEN || '').trim();
  if (!token) return 'not_configured';
  const raw = String(headers.authorization || headers.Authorization || '');
  const given = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length) return 'unauthorized';
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'unauthorized';
}

/** Decode the SautiKit JWT payload (no verification) for scope names only. */
function sautikitKeyScopes(rawKey = process.env.SAUTIKIT_API_KEY) {
  const key = String(rawKey || '').trim();
  if (!key) return { configured: false, workspaceId: null, scopes: [] };
  try {
    const part = key.split('.')[1];
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    const scopes = Array.isArray(json?.scopes) ? json.scopes.filter((s) => typeof s === 'string') : [];
    const workspaceId = typeof json?.workspace_id === 'string' ? json.workspace_id.slice(0, 8) : null;
    return { configured: true, workspaceId, scopes };
  } catch {
    return { configured: true, workspaceId: null, scopes: [] };
  }
}

function sautikitScopeChecks(rawKey) {
  const info = sautikitKeyScopes(rawKey);
  return {
    configured: info.configured,
    workspaceId: info.workspaceId,
    checks: REQUIRED_SAUTIKIT_SCOPES.map((scope) => ({ scope, ok: info.scopes.includes(scope) })),
  };
}

module.exports = {
  REQUIRED_SAUTIKIT_SCOPES,
  checkAdminHealthAuth,
  sautikitKeyScopes,
  sautikitScopeChecks,
};
