// Load curated Soniox voices from platform_soniox_voices (DB) with JSON fallback.
// Fallback lives under src/ so the Railway voice Docker image (no dashboard/) can boot.

const fallbackCatalog = require('../data/soniox-voices.json');

/**
 * @typedef {{ id: string, description?: string, default?: boolean, sortOrder?: number, active?: boolean }} CuratedVoice
 */

/** @type {CuratedVoice[]|null} */
let cachedDbVoices = null;
let cachedAt = 0;
const CACHE_MS = Number(process.env.SONIOX_VOICE_CATALOG_CACHE_MS || 30000);

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((v) => ({
      id: String(v?.id || '').trim(),
      description: String(v?.description || '').trim(),
      default: Boolean(v?.default ?? v?.is_default),
      sortOrder: Number(v?.sortOrder ?? v?.sort_order ?? 100),
      active: v?.active !== false && v?.is_active !== false,
    }))
    .filter((v) => v.id && v.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function fallbackVoices() {
  return normalizeRows(fallbackCatalog?.voices || []);
}

/**
 * Synchronous list — prefers last DB cache, else JSON seed file.
 * @returns {CuratedVoice[]}
 */
function listCuratedVoices() {
  if (cachedDbVoices && cachedDbVoices.length) return cachedDbVoices;
  return fallbackVoices();
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

/**
 * Refresh allowlist from Supabase (service role). Safe to call on boot / interval.
 * @param {{ force?: boolean }} [opts]
 */
async function refreshCuratedVoicesFromDb(opts = {}) {
  const now = Date.now();
  if (!opts.force && cachedDbVoices && now - cachedAt < CACHE_MS) {
    return cachedDbVoices;
  }

  try {
    const { supabase } = require('../lib/supabaseClient');
    const { data, error } = await supabase
      .from('platform_soniox_voices')
      .select('id, description, is_default, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.warn(
        `[soniox-voice-catalog] DB load failed, using JSON fallback: ${error.message}`
      );
      cachedDbVoices = null;
      return fallbackVoices();
    }

    const rows = normalizeRows(data || []);
    if (!rows.length) {
      console.warn('[soniox-voice-catalog] DB empty — using JSON fallback');
      cachedDbVoices = null;
      return fallbackVoices();
    }

    cachedDbVoices = rows;
    cachedAt = now;
    return rows;
  } catch (err) {
    console.warn(
      `[soniox-voice-catalog] DB load error, using JSON fallback: ${err?.message || err}`
    );
    cachedDbVoices = null;
    return fallbackVoices();
  }
}

module.exports = {
  listCuratedVoices,
  getDefaultVoiceId,
  isAllowedVoiceId,
  resolveCuratedVoiceId,
  refreshCuratedVoicesFromDb,
  fallbackVoices,
};
