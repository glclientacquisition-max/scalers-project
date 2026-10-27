'use strict';
// System-owned turn resolver (brain/turn-resolver-v1-model-call).
// Every ask in a caller turn is collected into a TurnAsk set, each ask is resolved
// against confirmed facts into exactly one of answered | unknown | out_of_area, the
// playbook moves on those resolutions (any unknown / out_of_area => callback offer,
// whether or not the model answered), and a fixed-order composer renders templates.
// The model only fills TurnAsk fields (place / service id / asks); it never speaks,
// and no fact (price, area, explain text) ever comes from it.
const N = require('./nlu');
const R = require('./receipts');
const L = require('./lexicon');
const { listedAreaRows } = require('../listedAreas');
const { joinList } = require('../spokenCatalogue');

// check_or_correct_detail (BRAIN_V2_REPLY_OWNER): a check of a detail we hold; the reply owner answers it from state
const ASKS = ['place', 'explain', 'price', 'possible', 'book', 'check_or_correct_detail'];
const POSSIBLE = /\b(is (it|that|this) possible|possible\??|can you (come|do|make it|manage)|could you (come|do)|are you able|do you (come|go|travel) (to|out)|inawezekana|mnaweza (kuja|kufika|kufanya)|mtaweza|unaweza kuja)\b/i;
const HOW = /\b(how (do|would|will) you (do|clean|handle) it|how (it'?s|it is) done|what (does|do) (it|that) (include|involve)|mnafanyaje|mnaifanyaje|inafanywa aje)\b/i;
const BOOK = /\b(book|booking|schedule|appointment|niwekee|weka booking|i want you to come|want (you|someone) to come|come (to|and) (clean|do)|mkuje|mje)\b/i;
// "Really?" / "Is it really 40 shillings?" right after a price answer is a price check, not a cut-off
const PRICE_CHALLENGE = /^\W*(uh\W+)?(really|seriously|are you sure|is (it|that) (really|true|right|correct)|kweli|ni kweli|una uhakika)\b|\bis (it|that|the .{1,40}?) really\b|\breally\W+\d+/i;
const KNOWN_TOWNS = /^(mombasa|kisumu|nakuru|eldoret|naivasha|nyeri|machakos|malindi|kitale|meru|kakamega|garissa|nanyuki|kericho|embu|kisii|lamu|diani|kilifi|voi|narok|nyahururu|bungoma|busia|thika|kiambu|ruiru|limuru|athi river|mlolongo|nanyuki|isiolo|marsabit|wajir|mandera|homa bay|migori|siaya|vihiga|bomet|kajiado|makueni|kitui|kerugoya|muranga|murang'a)$/i;

let PLACES = null;
const placeIdx = () => (PLACES ||= (() => { try { return require('../data/kenyaPlaceCounties.json').places || {}; } catch { return {}; } })());
const isKenyanPlace = (w) => { const k = String(w || '').toLowerCase().trim(); return KNOWN_TOWNS.test(k) || Object.prototype.hasOwnProperty.call(placeIdx(), k); };
const sameText = (a, b) => String(a || '').toLowerCase().includes(String(b || '').toLowerCase().trim());

/**
 * Build the TurnAsk set from the rules reading (u) plus any model fields that arrived.
 * Model fields are evidence only: a model place is kept only if its words are in the caller's text,
 * a model service id only if it is a catalogue row.
 */
function collectAsks({ u, text, state = {}, profile = {}, fields = null, lastService = null }) {
  const t = String(text || u?.text || '');
  const intents = new Set(u?.intents || []);
  const asks = new Set();
  const src = {};
  const add = (a, s) => { if (!asks.has(a)) { asks.add(a); src[a] = s; } };
  if (intents.has('explain') || HOW.test(t)) add('explain', 'rules');
  if (intents.has('price')) add('price', 'rules');
  if (POSSIBLE.test(t)) add('possible', 'rules');
  if (process.env.BRAIN_V2_REPLY_OWNER === 'on') { const RO = require('./replyOwner'); if (RO.NAME_Q.test(t) || RO.RIGHT_Q.test(t)) add('check_or_correct_detail', 'rules'); }
  if (intents.has('book') || intents.has('order') || BOOK.test(t)) add('book', 'rules');
  let price_challenge = false;
  if (!asks.has('price') && state.lastInfo === 'price' && PRICE_CHALLENGE.test(t)) { add('price', 'rules'); price_challenge = true; }
  let service = u?.service || null;
  let place = null;
  const area = u?.area || null;
  if (area && area.name) place = { text: area.name, listed: area.listed === true, source: 'rules' };
  else if (u?.place) place = { text: u.place, listed: null, source: 'rules' };
  if (fields && typeof fields === 'object') {
    for (const a of Array.isArray(fields.asks) ? fields.asks : []) if (ASKS.includes(a) && a !== 'place') add(a, 'model');
    if (!place && fields.place && sameText(t, fields.place)) place = { text: String(fields.place).trim(), listed: null, source: 'model' };
    if (!service && fields.service_id) {
      const row = (profile.servicesCatalog || []).find((s) => s.id === fields.service_id || s.factId === fields.service_id);
      if (row) { service = row; src.service = 'model'; }
    }
  }
  if (!service && price_challenge && lastService) service = lastService;
  if (place) add('place', place.source);
  return { text: t, service, place, asks: ASKS.filter((a) => asks.has(a)), src, price_challenge };
}

function areaCheck(place, profile, callerName = null) {
  if (!place) return null;
  if (callerName && String(place.text).toLowerCase() === String(callerName).toLowerCase()) return { status: 'unknown', fact: { place: place.text } };
  if (place.listed === true) return { status: 'answered', fact: { area: place.text } };
  const m = N.matchArea(place.text, profile);
  if (m && m.listed) return { status: 'answered', fact: { area: m.name } };
  const word = String(place.text).trim();
  if (isKenyanPlace(word) && ((m && m.listed === false) || place.listed === false || KNOWN_TOWNS.test(word))) return { status: 'out_of_area', fact: { place: L.cap(word.split(/[ ,]/)[0]) } };
  return { status: 'unknown', fact: { place: word } }; // an estate or a street: the read-back confirms it, never a guess
}

/**
 * Resolve each ask against confirmed facts only. deps.priceOf(svc) / deps.explainOf(svc)
 * come from the machine (spoken catalogue / Train); null means "no confirmed fact".
 */
function resolve(ask, profile = {}, deps = {}) {
  const out = [];
  const svc = ask.service;
  const label = svc ? (deps.labelOf ? deps.labelOf(svc) : svc.name) : null;
  const area = ask.asks.includes('place') ? areaCheck(ask.place, profile, deps.callerName) : null;
  for (const a of ask.asks) {
    if (a === 'place') { out.push({ ask: 'place', ...area }); continue; }
    if (a === 'check_or_correct_detail') { out.push({ ask: a, status: 'check', fact: {} }); continue; }
    if (a === 'explain') {
      if (!svc) { out.push({ ask: 'explain', status: 'unknown', fact: {} }); continue; }
      const ex = deps.explainOf ? deps.explainOf(svc) : null;
      out.push(ex ? { ask: 'explain', status: 'answered', fact: { label, text: ex } } : { ask: 'explain', status: 'unknown', fact: { label } });
      continue;
    }
    if (a === 'price') {
      const p = svc && deps.priceOf ? deps.priceOf(svc) : null;
      out.push(p ? { ask: 'price', status: 'answered', fact: { label, price: p, confirm: ask.price_challenge } } : { ask: 'price', status: 'unknown', fact: { label } });
      continue;
    }
    if (a === 'possible') {
      if (area && area.status === 'out_of_area') out.push({ ask: 'possible', status: 'out_of_area', fact: area.fact });
      else if (svc) out.push({ ask: 'possible', status: 'answered', fact: { label } });
      else out.push({ ask: 'possible', status: 'unknown', fact: {} });
      continue;
    }
    if (a === 'book') {
      if (area && area.status === 'out_of_area') out.push({ ask: 'book', status: 'out_of_area', fact: area.fact });
      else out.push({ ask: 'book', status: 'answered', fact: { label } });
    }
  }
  return out;
}

// ---------- playbook: enquiry -> resolve -> offer -> close ----------
// Transitions are driven by resolutions only. Any unknown / out_of_area => offer callback,
// whatever the model did. A resolved service with nothing missing => offer book.
const PLAYBOOK = { enquiry: ['resolve', 'close'], resolve: ['offer', 'resolve', 'close'], offer: ['resolve', 'close'], close: [] };
function playbookStep(pb = { state: 'enquiry' }, resolutions = [], { ended = false } = {}) {
  const from = (pb && pb.state) || 'enquiry';
  if (from === 'close') return { state: 'close', from, offer: null };
  if (ended) return { state: 'close', from, offer: null };
  const needCallback = resolutions.some((r) => r.status === 'unknown' || r.status === 'out_of_area');
  const service = (resolutions.find((r) => r.fact && r.fact.label) || {}).fact?.label || null;
  const offer = needCallback ? 'callback' : service ? 'book' : null;
  return { state: offer ? 'offer' : 'resolve', from, offer, service };
}

// ---------- composer: fixed order ----------
// honesty (out_of_area) -> answers (explain / price / possible) -> unknowns -> one offer.
function compose(resolutions = [], offer = null, lang = 'en', ctx = {}) {
  const S = L.isSw(lang);
  const parts = [];
  const outArea = resolutions.find((r) => r.status === 'out_of_area');
  if (outArea) {
    const areas = joinList(listedAreaRows(ctx.profile || {}).map((r) => r.name).filter(Boolean).slice(0, 4), lang);
    parts.push(R.info({ kind: 'area_out', place: outArea.fact.place, areas }, lang));
  }
  const byAsk = (k) => resolutions.find((r) => r.ask === k);
  const ex = byAsk('explain'); const pr = byAsk('price'); const po = byAsk('possible'); const pl = byAsk('place');
  if (pl && pl.status === 'answered' && !outArea) parts.push(S ? `${pl.fact.area} iko kwenye orodha ya maeneo yetu.` : `${pl.fact.area} is on our list of service areas.`);
  if (ex && ex.status === 'answered') parts.push(ex.fact.text);
  if (po && po.status === 'answered' && !(ex && ex.status === 'answered')) parts.push(S ? `Ndio, tunafanya ${R.svcName(po.fact.label, lang)}.` : `Yes, we do ${R.svcName(po.fact.label, lang).toLowerCase()}.`);
  if (pr && pr.status === 'answered') {
    const line = R.info({ kind: 'price', found: true, label: pr.fact.label, price: pr.fact.price }, lang);
    parts.push(pr.fact.confirm ? (S ? `Ndio, kwenye orodha yetu ${line.charAt(0).toLowerCase()}${line.slice(1)}` : `Yes, on our list ${line.charAt(0).toLowerCase()}${line.slice(1)}`) : line);
  }
  // unknowns: never a bare label, never a guess
  if (ex && ex.status === 'unknown') {
    parts.push(ex.fact.label
      ? (S ? `Tunafanya ${R.svcName(ex.fact.label, lang)}, lakini sina maelezo ya jinsi inavyofanywa.` : `We do ${R.svcName(ex.fact.label, lang).toLowerCase()}, but I don't have the details of how it's done.`)
      : (S ? 'Sina maelezo ya hiyo kwenye orodha yetu.' : "I don't have details on that on our list."));
  }
  if (pr && pr.status === 'unknown') parts.push(S ? 'Sina bei ya hiyo kwenye orodha yetu.' : "I don't have a price for that on our list.");
  if (pl && pl.status === 'unknown' && !outArea) parts.push(S ? `Sina uhakika kama tunafika ${pl.fact.place}.` : `I'm not sure we cover ${pl.fact.place}.`);
  if (offer === 'callback') parts.push(S ? 'Ungependa timu ikupigie simu kuthibitisha?' : 'Would you like the team to call you back to confirm?');
  else if (offer === 'book') parts.push(S ? 'Ungependa kubook?' : 'Would you like to book?');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Rules intents the resolver may stand in for; anything else (cancel, change, coverage, hours, policy,
// handoff, ...) keeps its own receipt path, which already resolves honestly.
const RESOLVABLE = new Set(['explain', 'price', 'book', 'availability', 'check', 'want_know']);
/** Does the resolver own this turn? Multi-ask, an honesty-needed resolution the legacy path would drop, or a price check. */
function owns(ask, resolutions, u = {}) {
  const intents = u.intents || [];
  if (u.yes || u.no || u.done) return false;
  if (ask.asks.includes('check_or_correct_detail')) return false; // the reply owner answers checks
  if (intents.some((i) => !RESOLVABLE.has(i))) return false;
  if (ask.price_challenge) return true;
  const legacyPlace = intents.includes('book') || intents.includes('coverage');
  if (!legacyPlace && resolutions.some((r) => r.status === 'out_of_area')) return true;
  if (resolutions.some((r) => r.ask === 'explain' && r.status === 'unknown' && r.fact.label)) return true;
  const info = ask.asks.filter((a) => a === 'explain' || a === 'price' || a === 'possible').length;
  // the rules missed the service and the model named a catalogue row: the resolver answers from that row
  if (ask.src && ask.src.service === 'model' && ask.service && info >= 1) return true;
  return info >= 2;
}

module.exports = { ASKS, PLAYBOOK, collectAsks, areaCheck, resolve, playbookStep, compose, owns, PRICE_CHALLENGE, POSSIBLE };
