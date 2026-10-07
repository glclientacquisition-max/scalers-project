// Trace seam for a later Gemini Live audio model.
// VOICE_GEMINI_LIVE defaults off. Turning it on records
// provider: 'gemini-live' on the model stage. It does not
// replace the media stack, the tools, or the Kiswahili mouth.
// The stage stays inside the JSON payload. No new column.

function geminiLiveEnabled(env = process.env) {
  const raw = String(env.VOICE_GEMINI_LIVE ?? 'off').trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true' || raw === 'yes';
}

function modelStageProvider(fallback = 'gemini', env = process.env) {
  if (geminiLiveEnabled(env)) return 'gemini-live';
  return fallback || 'gemini';
}

module.exports = {
  geminiLiveEnabled,
  modelStageProvider,
};
