// VOICE_STRUCTURED_OUTPUT: Phase 2 structured, language-locked Gemini output.
// off (default everywhere) keeps the legacy filter mouth byte-for-byte.
// on routes Gemini voice turns through src/speech/structured/ and bypasses
// the post-generation filter stack. Set it explicitly per Railway service;
// there is no environment-name auto rule (#583's `auto` was too implicit).
// Per-tenant enablement (VOICE_STRUCTURED_TENANTS) is Phase 6, not here.

const ON = new Set(['on', '1', 'true', 'yes']);
const OFF = new Set(['off', '0', 'false', 'no']);

function structuredOutputEnabled(env = process.env) {
  return ON.has(String(env.VOICE_STRUCTURED_OUTPUT || 'off').trim().toLowerCase());
}

/**
 * Sentence marks at the TTS boundary. on (default, matching main since #612 /
 * HD_72ab69cbab2b and the staging punctuation A/B) keeps . , ? on the wire:
 * Soniox voices none of them and they give the comma/stop pauses and the
 * question rise. off strips them (the original Phase 2 default).
 */
function prosodyMarksEnabled(env = process.env) {
  const raw = String(env.VOICE_TTS_PROSODY_MARKS || 'on').trim().toLowerCase();
  return !OFF.has(raw);
}

/**
 * Built-in syllable respellings ("Kee-ten-geh-la") on the structured path.
 * off (default) speaks the plain name; tenant lexicon entries still apply.
 * on restores the legacy respellings until a round trip proves which names
 * Soniox actually mispronounces.
 */
function builtinRespellEnabled(env = process.env) {
  return ON.has(String(env.VOICE_STRUCTURED_RESPELL || 'off').trim().toLowerCase());
}

module.exports = {
  structuredOutputEnabled,
  prosodyMarksEnabled,
  builtinRespellEnabled,
};
