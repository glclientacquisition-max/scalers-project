// Canonical Scalers receptionist voice — Soniox cloned voice (UUID, not built-in name).
const SCALERS_SONIOX_VOICE_ID = '7b197f3c-84b4-4404-986f-114e4dac1432';

const SONIOX_VOICES_API =
  process.env.SONIOX_VOICES_API || 'https://api.soniox.com/v1/voices';

/**
 * Scalers production TTS voice. Built-in Soniox voice names are not used.
 * SONIOX_VOICE is ignored when set to a different value (logged once at startup).
 */
function resolveSonioxVoice() {
  return SCALERS_SONIOX_VOICE_ID;
}

function isUuidVoice(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

/**
 * @param {string} model
 * @returns {Promise<{ ok: boolean, status?: string, voiceId: string, model: string, error?: string, raw?: unknown }>}
 */
async function fetchVoiceModelStatus(model) {
  const apiKey = process.env.SONIOX_API_KEY;
  const voiceId = resolveSonioxVoice();
  if (!apiKey) {
    return { ok: false, voiceId, model, error: 'SONIOX_API_KEY missing' };
  }

  const url = `${SONIOX_VOICES_API}/${encodeURIComponent(voiceId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      voiceId,
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
    voiceId,
    model,
    error:
      status === 'ready'
        ? undefined
        : entry?.error_message || `model ${model} status=${status}`,
    raw,
  };
}

/**
 * Prepare cloned voice for the active TTS model if Soniox reports not_computed.
 * @param {string} model
 */
async function recomputeVoiceForModel(model) {
  const apiKey = process.env.SONIOX_API_KEY;
  const voiceId = resolveSonioxVoice();
  if (!apiKey) return { ok: false, error: 'SONIOX_API_KEY missing' };

  const url = `${SONIOX_VOICES_API}/${encodeURIComponent(voiceId)}/recompute`;
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
 * Verify cloned voice is ready for realtime TTS; trigger recompute when needed.
 * @param {{ model?: string, log?: (line: string) => void }} [opts]
 */
async function ensureSonioxVoiceReady(opts = {}) {
  const log = opts.log || console.log;
  const model =
    opts.model || process.env.SONIOX_TTS_MODEL || 'tts-rt-v1';
  const voiceId = resolveSonioxVoice();

  const envVoice = String(process.env.SONIOX_VOICE || '').trim();
  if (envVoice && envVoice !== voiceId) {
    log(
      `ℹ SONIOX_VOICE=${envVoice} ignored — Scalers uses cloned voice ${voiceId}`
    );
  }

  let status = await fetchVoiceModelStatus(model);
  if (status.ok) {
    log(`✓ Soniox cloned voice ready model=${model} voice=${voiceId}`);
    return status;
  }

  if (status.status === 'not_computed') {
    log(`ℹ Soniox voice not prepared for ${model} — requesting recompute…`);
    const recompute = await recomputeVoiceForModel(model);
    if (!recompute.ok) {
      log(`⚠ Soniox voice recompute failed: ${recompute.error}`);
      return { ...status, ok: false, error: recompute.error };
    }
    status = await fetchVoiceModelStatus(model);
    if (status.ok) {
      log(`✓ Soniox cloned voice ready after recompute model=${model}`);
      return status;
    }
  }

  log(
    `⚠ Soniox cloned voice not ready model=${model} status=${status.status || 'unknown'} — ${status.error || ''}`
  );
  return status;
}

module.exports = {
  SCALERS_SONIOX_VOICE_ID,
  resolveSonioxVoice,
  isUuidVoice,
  fetchVoiceModelStatus,
  recomputeVoiceForModel,
  ensureSonioxVoiceReady,
};
