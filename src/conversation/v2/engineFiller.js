'use strict';
// BRAIN_ENGINES filler: only when the understanding wait passes BRAIN_ENGINES_FILLER_MS. Says what is
// happening for THIS turn (checking hours, the area, the price, noting the booking). Never a generic
// "Sawa"/"Okay" ack. Chosen from the rules read of the turn (no model call, <1 ms).
const N = require('./nlu');

const LINES = {
  hours: { en: 'Let me check our hours.', sw: 'Ngoja niangalie saa zetu za kazi.' },
  coverage: { en: 'Let me check that area.', sw: 'Ngoja niangalie eneo hilo.' },
  price: { en: 'Let me check the price.', sw: 'Ngoja niangalie bei.' },
  book: { en: 'Let me note that down.', sw: 'Ngoja niandike hilo.' },
  callback: { en: 'Let me arrange that.', sw: 'Ngoja nipange hilo.' },
  other: { en: 'Just a moment while I check.', sw: 'Subiri kidogo niangalie.' },
};

function topicOf(text, profile, machine, now) {
  let nu = {};
  try { nu = N.understand(String(text || ''), { profile, now, expecting: machine?.expecting || null }); } catch { nu = {}; }
  const it = nu.intents || [];
  if (it.includes('hours')) return 'hours';
  if (it.includes('price')) return 'price';
  if (it.includes('coverage') || nu.place || nu.area) return 'coverage';
  if (it.includes('callback') || it.includes('handoff')) return 'callback';
  if (it.includes('book') || nu.when || (machine?.eng?.flow)) return 'book';
  return 'other';
}

function pickFiller(text, lang, { profile = {}, machine = {}, now = new Date() } = {}) {
  const t = String(text || '').trim();
  // a bare yes/no or a name needs no filler line: the answer comes next
  if (!t || t.split(/\s+/).length <= 2) return null;
  const k = topicOf(t, profile, machine, now);
  return LINES[k][lang === 'sw' ? 'sw' : 'en'];
}

module.exports = { pickFiller, LINES };
