// VOICE_STRUCTURED_REPLY
// auto (default): on in staging, preview, and local dev. Off when the
// Railway environment name contains "prod", or NODE_ENV=production and
// there is no Railway name.
// VOICE_ROLLOUT_TENANTS, when set, replaces that rule for the given id.

const { rolloutAllows } = require('./voiceRollout');

function railwayEnvironmentName(env = process.env) {
  return String(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || '').toLowerCase();
}

function autoStructured(env = process.env) {
  const raw = String(env.VOICE_STRUCTURED_REPLY || 'auto').trim().toLowerCase();
  if (raw === 'on' || raw === '1' || raw === 'true') return true;
  if (raw === 'off' || raw === '0' || raw === 'false') return false;
  const railway = railwayEnvironmentName(env);
  if (railway.includes('prod')) return false;
  if (String(env.NODE_ENV || '').toLowerCase() === 'production' && !railway) {
    return false;
  }
  return true;
}

function structuredReplyEnabled(tenantId, env = process.env) {
  const listed = rolloutAllows(tenantId, env);
  if (listed != null) return listed;
  return autoStructured(env);
}

module.exports = {
  structuredReplyEnabled,
  railwayEnvironmentName,
};
