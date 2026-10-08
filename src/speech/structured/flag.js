// VOICE_STRUCTURED_OUTPUT: Phase 2 structured, language-locked Gemini output.
// off (default everywhere) keeps the legacy filter mouth byte-for-byte.
// on routes Gemini voice turns through src/speech/structured/ and bypasses
// the post-generation filter stack. Set it explicitly per Railway service;
// there is no environment-name auto rule (#583's `auto` was too implicit).
// Per-tenant enablement (VOICE_STRUCTURED_TENANTS) is Phase 6, not here.

const ON = new Set(['on', '1', 'true', 'yes']);

function structuredOutputEnabled(env = process.env) {
  return ON.has(String(env.VOICE_STRUCTURED_OUTPUT || 'off').trim().toLowerCase());
}

/**
 * Sentence marks at the TTS boundary. off (default) strips them as the
 * legacy path does since #585. on keeps . , ? once a Soniox TTS -> STT
 * round trip shows marks are not voiced when pieces carry a word gap.
 */
function prosodyMarksEnabled(env = process.env) {
  return ON.has(String(env.VOICE_TTS_PROSODY_MARKS || 'off').trim().toLowerCase());
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
