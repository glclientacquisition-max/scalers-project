// One deploy knob for how the receptionist sounds on the phone.
// Soniox TTS has speed, not volume. Loudness is a PCM gain on outbound audio.

function clampSpeed(n, fallback = 1) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(1.3, Math.max(0.7, x));
}

function clampGain(n, fallback = 1) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return fallback;
  return Math.min(2.5, Math.max(0.5, x));
}

const PROFILES = {
  // Kenya DID default: natural Soniox pace, same EN/SW speed, phone-level gain.
  balanced: {
    name: 'balanced',
    speedEn: 1.0,
    speedSw: 1.0,
    gain: 1.38,
    fillerDelayMs: 400,
  },
  // Slightly quicker. Same EN/SW pace. Still under 1.2 so Safaricom/Airtel stay clear.
  snappy: {
    name: 'snappy',
    speedEn: 1.06,
    speedSw: 1.06,
    gain: 1.38,
    fillerDelayMs: 320,
  },
};

function resolveVoiceProfile(env = process.env) {
  const raw = String(env.VOICE_PROFILE || 'balanced')
    .trim()
    .toLowerCase();
  const base = PROFILES[raw] || PROFILES.balanced;
  const speedEn = env.SONIOX_TTS_SPEED_EN || env.SONIOX_TTS_SPEED || base.speedEn;
  const speedSw = env.SONIOX_TTS_SPEED_SW || env.SONIOX_TTS_SPEED || base.speedSw;
  const gain = env.VOICE_TTS_GAIN || base.gain;
  const fillerDelayMs = Number(env.VOICE_FILLER_DELAY_MS || base.fillerDelayMs);
  return {
    name: base.name,
    speedEn: clampSpeed(speedEn, base.speedEn),
    speedSw: clampSpeed(speedSw, base.speedSw),
    gain: clampGain(gain, base.gain),
    fillerDelayMs: Number.isFinite(fillerDelayMs) ? fillerDelayMs : base.fillerDelayMs,
  };
}

function speedForLanguage(lang, env = process.env) {
  const profile = resolveVoiceProfile(env);
  return lang === 'sw' ? profile.speedSw : profile.speedEn;
}

/** Thinking-acks follow the call language. Unknown stays English so EN greetings are not followed by Sawa/Poa. */
function fillerLanguage(callLanguage) {
  const lang = String(callLanguage || '').toLowerCase();
  return lang === 'sw' || lang === 'sheng' ? 'sw' : 'en';
}

function publicVoiceProfile(env = process.env) {
  const profile = resolveVoiceProfile(env);
  return {
    name: profile.name,
    speedEn: profile.speedEn,
    speedSw: profile.speedSw,
    gain: profile.gain,
    fillerDelayMs: profile.fillerDelayMs,
  };
}

module.exports = {
  PROFILES,
  clampSpeed,
  clampGain,
  resolveVoiceProfile,
  speedForLanguage,
  fillerLanguage,
  publicVoiceProfile,
};
