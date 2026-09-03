/**
 * Cautious downtime copy for when Soniox STT/TTS is down.
 * Same person as the phone greeting. English default until the caller has spoken.
 * No fluff. No em dashes.
 */

const OUTAGE_LINE_EN =
  'Hello. This line is on a short downtime. Please call back in a few minutes.';
const OUTAGE_LINE_SW =
  'Habari. Simu hii ina downtime fupi. Tafadhali piga tena baada ya dakika chache.';

function pickSpeechOutageLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return OUTAGE_LINE_SW;
  return OUTAGE_LINE_EN;
}

function outageClipLang(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return 'sw';
  return 'en';
}

module.exports = {
  OUTAGE_LINE_EN,
  OUTAGE_LINE_SW,
  pickSpeechOutageLine,
  outageClipLang,
};
