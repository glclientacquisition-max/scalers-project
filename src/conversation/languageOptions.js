// Automatic Kenya voice languages: English, Kiswahili, Sheng.
// Local languages are deferred — no onboarding picker.

const AUTO_VOICE_LANGUAGES = ['en', 'sw', 'sheng'];

function normalizeVoiceLanguages(_raw) {
  // Always auto — ignore stored/picker values for now.
  return [...AUTO_VOICE_LANGUAGES];
}

function formatVoiceLanguagesLine() {
  return 'English, Kiswahili, and Sheng';
}

/**
 * Fixed language policy for every tenant (no user selection).
 */
function tenantLanguagePolicy() {
  return [
    'BUSINESS VOICE LANGUAGES (automatic): English, Kiswahili, and Sheng.',
    'Mirror the caller naturally: English → English, Kiswahili → Kiswahili, Sheng → light natural Sheng.',
    'If the caller mixes, mirror their mix lightly. Prefer clear short sentences.',
    'Do not invent or force slang. Local Kenyan languages (Kikuyu, Luo, etc.) are not enabled yet — if heard, reply in Kiswahili or English.',
  ].join(' ');
}

function sttLanguageHints() {
  return ['en', 'sw'];
}

module.exports = {
  AUTO_VOICE_LANGUAGES,
  DEFAULT_VOICE_LANGUAGES: AUTO_VOICE_LANGUAGES,
  normalizeVoiceLanguages,
  formatVoiceLanguagesLine,
  tenantLanguagePolicy,
  sttLanguageHints,
};
