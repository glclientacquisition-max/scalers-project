// Soniox spend cut (Alvin GO via Chief 2026-10-24): stop streaming caller
// silence to STT. Soniox bills every second of audio we send, and most of a
// phone call is the caller listening. VOICE_STT_SILENCE_GATE=on gates silent
// caller frames by RMS energy; while gated the session gets a keepalive so
// the socket stays open.
//
// Barge-in is untouched: while TTS is speaking (and for a short tail after),
// every frame goes to STT, same as before. A short pre-roll is flushed when
// speech starts so the first syllable after silence is not lost, and a
// hangover keeps forwarding trailing silence long enough for Soniox endpoint
// detection (max_endpoint_delay_ms, default 700) to close the utterance.

const PCM_BYTES_PER_MS = 32; // 16 kHz mono s16le

function num(env, name, dflt, min, max) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}

function sttSilenceGateOn(env = process.env) {
  return String(env.VOICE_STT_SILENCE_GATE ?? '').trim() === 'on';
}

function gateConfig(env = process.env) {
  return {
    rms: num(env, 'VOICE_STT_GATE_RMS', 300, 10, 10000),
    prerollMs: num(env, 'VOICE_STT_GATE_PREROLL_MS', 300, 0, 2000),
    hangoverMs: num(env, 'VOICE_STT_GATE_HANGOVER_MS', 1000, 200, 5000),
    ttsTailMs: num(env, 'VOICE_STT_GATE_TTS_TAIL_MS', 800, 0, 5000),
    keepaliveMs: num(env, 'VOICE_STT_KEEPALIVE_MS', 8000, 1000, 15000),
  };
}

/** RMS of a little-endian PCM16 frame (odd trailing byte ignored). */
function frameRms(buf) {
  if (!buf || buf.length < 2) return 0;
  const n = Math.floor(buf.length / 2);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/**
 * @param {{ enabled?: boolean, now?: () => number, config?: object, env?: object }} [opts]
 * admit(buf, { ttsSpeaking }) -> { send: Buffer[], keepalive: boolean, voiced: boolean, gated: boolean }
 */
function createSttSilenceGate(opts = {}) {
  const env = opts.env || process.env;
  const enabled = opts.enabled != null ? Boolean(opts.enabled) : sttSilenceGateOn(env);
  const cfg = { ...gateConfig(env), ...(opts.config || {}) };
  const now = opts.now || (() => Date.now());
  const preroll = [];
  let prerollBytes = 0;
  let openUntil = 0;
  let ttsUntil = 0;
  let lastSendAt = now();
  const stats = { framesIn: 0, bytesIn: 0, framesSent: 0, bytesSent: 0, bytesGated: 0, keepalives: 0 };

  function pushPreroll(buf) {
    if (!cfg.prerollMs) return;
    preroll.push(buf);
    prerollBytes += buf.length;
    const cap = cfg.prerollMs * PCM_BYTES_PER_MS;
    while (preroll.length > 1 && prerollBytes - preroll[0].length >= cap) {
      prerollBytes -= preroll.shift().length;
    }
  }

  function emit(list) {
    for (const b of list) {
      stats.framesSent += 1;
      stats.bytesSent += b.length;
    }
    if (list.length) lastSendAt = now();
    return list;
  }

  function admit(buf, { ttsSpeaking = false } = {}) {
    stats.framesIn += 1;
    stats.bytesIn += buf.length;
    const t = now();
    const voiced = frameRms(buf) >= cfg.rms;
    if (!enabled) return { send: emit([buf]), keepalive: false, voiced, gated: false };
    if (ttsSpeaking) ttsUntil = t + cfg.ttsTailMs;
    if (voiced) openUntil = t + cfg.hangoverMs;
    // Full feed during TTS (barge-in), its tail, speech and its hangover.
    if (ttsSpeaking || t < ttsUntil || t < openUntil) {
      const out = preroll.length ? [...preroll, buf] : [buf];
      preroll.length = 0;
      prerollBytes = 0;
      return { send: emit(out), keepalive: false, voiced, gated: false };
    }
    pushPreroll(buf);
    stats.bytesGated += buf.length;
    let keepalive = false;
    if (t - lastSendAt >= cfg.keepaliveMs) {
      keepalive = true;
      lastSendAt = t;
      stats.keepalives += 1;
    }
    return { send: [], keepalive, voiced, gated: true };
  }

  return { admit, stats, enabled, config: cfg };
}

module.exports = { PCM_BYTES_PER_MS, sttSilenceGateOn, gateConfig, frameRms, createSttSilenceGate };
