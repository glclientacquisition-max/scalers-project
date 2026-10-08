const en = require('./en');
const sw = require('./sw');
const sheng = require('./sheng');

const PACKS = { en, sw, sheng };
const LOCKABLE = Object.keys(PACKS);

function getLanguagePack(lang) {
  return PACKS[String(lang || '').toLowerCase()] || en;
}

module.exports = { PACKS, LOCKABLE, getLanguagePack };
