const sw = require('./sw');

module.exports = {
  code: 'sheng',
  tts: 'en',
  repair: 'Samahani, sema tena?',
  silence: 'Samahani, sikusikia.',
  directive:
    'Reply in light Sheng. Keep slang sparse so it stays easy to pronounce. Job nouns may stay in English.',
  services: sw.services,
  priceKnown: sw.priceKnown,
  priceUnknown: 'Sina bei hiyo kwa file. Naweza note kwa team.',
  coverage: sw.coverage,
  nameAnswer: sw.nameAnswer,
  nameConfirm: sw.nameConfirm,
  complaint: 'Pole. Naelewa uko na complaint. Naweza tuma kwa manager.',
  understand: 'Sawa, nimeelewa.',
};
