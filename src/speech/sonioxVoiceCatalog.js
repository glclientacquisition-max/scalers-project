// Curated Soniox voice allowlist (Option A). Add clones in dashboard/src/data/soniox-voices.json.
const catalog = require('../../dashboard/src/data/soniox-voices.json');

/**
 * @typedef {{ id: string, description?: string, default?: boolean }} CuratedVoice
 */

/** @returns {CuratedVoice[]} */
function listCuratedVoices() {
  const voices = Array.isArray(catalog?.voices) ? catalog.voices : [];
  return voices
    .map((v) => ({
      id: String(v?.id || '').trim(),
      description: String(v?.description || '').trim(),
      default: Boolean(v?.default),
    }))
    .filter((v) => v.id);
}

function getDefaultVoiceId() {
  const voices = listCuratedVoices();
  const marked = voices.find((v) => v.default);
  return marked?.id || voices[0]?.id || null;
}

function isAllowedVoiceId(voiceId) {
  const id = String(voiceId || '').trim();
  if (!id) return false;
  return listCuratedVoices().some((v) => v.id === id);
}

/**
 * Tenant override when allowed; otherwise platform default.
 * @param {string|null|undefined} tenantVoiceId
 */
function resolveCuratedVoiceId(tenantVoiceId) {
  const id = String(tenantVoiceId || '').trim();
  if (id && isAllowedVoiceId(id)) return id;
  const fallback = getDefaultVoiceId();
  if (!fallback) {
    throw new Error('No curated Soniox voices configured');
  }
  return fallback;
}

module.exports = {
  listCuratedVoices,
  getDefaultVoiceId,
  isAllowedVoiceId,
  resolveCuratedVoiceId,
};
