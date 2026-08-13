// Canonical Scalers receptionist voice — kept for backwards-compatible imports.
const {
  getDefaultVoiceId,
  resolveCuratedVoiceId,
  isAllowedVoiceId,
  listCuratedVoices,
  refreshCuratedVoicesFromDb,
} = require('./sonioxVoiceCatalog');

const SCALERS_SONIOX_VOICE_ID = getDefaultVoiceId();

const SONIOX_VOICES_API =
  process.env.SONIOX_VOICES_API || 'https://api.soniox.com/v1/voices';

/**
 * Resolve Soniox TTS voice for a call or preview.
 * @param {string|null|undefined} [tenantVoiceId]
 */
function resolveSonioxVoice(tenantVoiceId) {
  return resolveCuratedVoiceId(tenantVoiceId);
}

function isUuidVoice(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

/**
 * @param {string} model
 * @param {string} [voiceId]
 */
async function fetchVoiceModelStatus(model, voiceId) {
  const apiKey = process.env.SONIOX_API_KEY;
  const resolvedId = resolveSonioxVoice(voiceId);
  if (!apiKey) {
    return { ok: false, voiceId: resolvedId, model, error: 'SONIOX_API_KEY missing' };
  }

  const url = `${SONIOX_VOICES_API}/${encodeURIComponent(resolvedId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      voiceId: resolvedId,
      model,
      error: `GET voice failed ${res.status}: ${body.slice(0, 200)}`,
    };
  }

  const raw = await res.json();
  const models = Array.isArray(raw?.models) ? raw.models : [];
  const entry = models.find((m) => m && m.model === model);
  const status = entry?.status || 'missing';
  return {
    ok: status === 'ready',
    status,
    voiceId: resolvedId,
    model,
    error:
      status === 'ready'
        ? undefined
        : entry?.error_message || `model ${model} status=${status}`,
    raw,
  };
}

/**
 * @param {string} model
 * @param {string} [voiceId]
 */
async function recomputeVoiceForModel(model, voiceId) {
  const apiKey = process.env.SONIOX_API_KEY;
  const resolvedId = resolveSonioxVoice(voiceId);
  if (!apiKey) return { ok: false, error: 'SONIOX_API_KEY missing' };

  const url = `${SONIOX_VOICES_API}/${encodeURIComponent(resolvedId)}/recompute`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `recompute failed ${res.status}: ${body.slice(0, 200)}` };
  }

  return { ok: true };
}

/**
 * Verify curated voices are ready for realtime TTS; trigger recompute when needed.
 * @param {{ model?: string, log?: (line: string) => void }} [opts]
 */
async function ensureSonioxVoiceReady(opts = {}) {
  const log = opts.log || console.log;
  const model =
    opts.model || process.env.SONIOX_TTS_MODEL || 'tts-rt-v1';

  const envVoice = String(process.env.SONIOX_VOICE || '').trim();
  if (envVoice && !isAllowedVoiceId(envVoice)) {
    log(`ℹ SONIOX_VOICE=${envVoice} ignored — use tenants.soniox_voice_id + curated catalog`);
  }

  const voices = listCuratedVoices();
  if (!voices.length) {
    log('⚠ No curated Soniox voices in src/data/soniox-voices.json');
    return { ok: false, error: 'empty catalog' };
  }

  let allOk = true;
  for (const voice of voices) {
    let status = await fetchVoiceModelStatus(model, voice.id);
    if (status.ok) {
      log(`✓ Soniox voice ready model=${model} voice=${voice.id}${voice.description ? ` (${voice.description})` : ''}`);
      continue;
    }

    if (status.status === 'not_computed') {
      log(`ℹ Soniox voice ${voice.id} not prepared for ${model} — recompute…`);
      const recompute = await recomputeVoiceForModel(model, voice.id);
      if (!recompute.ok) {
        log(`⚠ Soniox voice recompute failed (${voice.id}): ${recompute.error}`);
        allOk = false;
        continue;
      }
      status = await fetchVoiceModelStatus(model, voice.id);
      if (status.ok) {
        log(`✓ Soniox voice ready after recompute voice=${voice.id}`);
        continue;
      }
    }

    allOk = false;
    log(
      `⚠ Soniox voice not ready voice=${voice.id} model=${model} status=${status.status || 'unknown'} — ${status.error || ''}`
    );
  }

  return { ok: allOk };
}

module.exports = {
  SCALERS_SONIOX_VOICE_ID,
  resolveSonioxVoice,
  isUuidVoice,
  isAllowedVoiceId,
  listCuratedVoices,
  refreshCuratedVoicesFromDb,
  fetchVoiceModelStatus,
  recomputeVoiceForModel,
  ensureSonioxVoiceReady,
};
