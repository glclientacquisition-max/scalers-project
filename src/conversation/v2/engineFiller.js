'use strict';
// BRAIN_ENGINES filler: only when the understanding wait passes BRAIN_ENGINES_FILLER_MS. Says what is
// happening for THIS turn (checking hours, the area, the price, noting the booking). Never a generic
// "Sawa"/"Okay" ack. Chosen from the rules read of the turn (no model call, <1 ms).
const N = require('./nlu');

// Short on purpose: about three words, well under ~1 s spoken, so it is finished before the real line.
const LINES = {
  hours: { en: 'Checking our hours.', sw: 'Naangalia saa zetu.' },
  coverage: { en: 'Checking that area.', sw: 'Naangalia eneo hilo.' },
  price: { en: 'Checking the price.', sw: 'Naangalia bei.' },
  book: { en: 'Noting that down.', sw: 'Naandika hilo.' },
  callback: { en: 'Arranging that now.', sw: 'Napanga hilo.' },
  other: { en: 'One moment, checking.', sw: 'Subiri, naangalia.' },
};

// Voice's own filler fires at 900 ms; ours must always come first, so the delay is clamped to 850 ms.
const FILLER_DEFAULT_MS = 700;
const FILLER_MAX_MS = 850;
function fillerDelayMs(env = {}) {
  const raw = env.BRAIN_ENGINES_FILLER_MS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return FILLER_DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return FILLER_DEFAULT_MS;
  if (n <= 0) return 0; // explicit 0 = no engines filler
  return Math.min(Math.round(n), FILLER_MAX_MS);
}

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

module.exports = { pickFiller, fillerDelayMs, LINES, FILLER_DEFAULT_MS, FILLER_MAX_MS };
