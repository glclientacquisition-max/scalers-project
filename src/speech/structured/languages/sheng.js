const sw = require('./sw');

// Sheng rides English TTS (as ttsLanguageFor does on the legacy path).
module.exports = {
  ...sw,
  code: 'sheng',
  tts: 'en',
  name: 'light Sheng',
  directive:
    'Write every say item in light, clear Sheng. Keep slang sparse so it stays easy to pronounce. Job nouns may stay in English.',
  repair: 'Sorry, sema tena?',
  unverified: 'Nitacheck na team wa-confirm hiyo.',
};
