/** Mirror of dashboard/src/lib/deskFeatureFlags.ts for Voice runtime. */

function envFlagOn(value) {
  return String(value || '').trim() === 'on';
}

function factPaymentsV2Hash(env) {
  return envFlagOn(env ? env.FACT_PAYMENTS_V2_HASH : process.env.FACT_PAYMENTS_V2_HASH);
}

function deskAttestServiceAreas(env) {
  return envFlagOn(env ? env.DESK_ATTEST_SERVICE_AREAS : process.env.DESK_ATTEST_SERVICE_AREAS);
}

function voiceFallbackByKind(env) {
  return envFlagOn(env ? env.VOICE_FALLBACK_BY_KIND : process.env.VOICE_FALLBACK_BY_KIND);
}

module.exports = {
  envFlagOn,
  factPaymentsV2Hash,
  deskAttestServiceAreas,
  voiceFallbackByKind,
};
