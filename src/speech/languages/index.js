const en = require('./en');
const sw = require('./sw');
const sheng = require('./sheng');

const PACKS = { en, sw, sheng };

function getLanguagePack(lang) {
  const code = String(lang || '').toLowerCase();
  if (code === 'sw') return sw;
  if (code === 'sheng') return sheng;
  return en;
}

module.exports = {
  PACKS,
  getLanguagePack,
};
