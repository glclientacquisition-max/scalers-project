// VOICE_STRUCTURED_REPLY
// auto (default): on in staging, preview, and local dev. Off when the
// Railway environment name contains "prod", or NODE_ENV=production and
// there is no Railway name.

function railwayEnvironmentName() {
  return String(
    process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || ''
  ).toLowerCase();
}

function structuredReplyEnabled() {
  const raw = String(process.env.VOICE_STRUCTURED_REPLY || 'auto').trim().toLowerCase();
  if (raw === 'on' || raw === '1' || raw === 'true') return true;
  if (raw === 'off' || raw === '0' || raw === 'false') return false;
  const railway = railwayEnvironmentName();
  if (railway.includes('prod')) return false;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && !railway) {
    return false;
  }
  return true;
}

module.exports = {
  structuredReplyEnabled,
  railwayEnvironmentName,
};
