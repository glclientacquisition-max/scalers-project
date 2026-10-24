'use strict';
// BRAIN_V1_DRAFT verifier: deterministic, no model. Each draft sentence is checked BEFORE TTS.
// A sentence that states a fact (price, area/coverage, availability, hours, service existence or
// description, booking/callback status, caller name, payment) must cite fact ids from this turn's
// note and match them by value. Any unverified fact -> the WHOLE sentence is replaced (Alvin 11:19 EAT).
// Availability is never verifiable here: it only comes through the booking flow (Alvin 11:20 EAT).
const N = require('./nlu');
const L = require('./lexicon');
const { num } = require('./v1draftFacts');

const NEG = /\b(don'?t|do not|doesn'?t|not|no|unfortunately|outside|isn'?t|aren'?t|hatu\w*|haitu\w*|hapana|siyo|sio)\b/i;
const OFFER_Q = /\b(would you like|do you want|shall i|should i|can i|may i|ungependa|unataka|nikupangie|nikuwekee|tukupigie)\b[^?]*\?\s*$/i;
const RE = {
  availability: /\b(available|availability|free (?:at|on|tomorrow|today|slot)|slots?|openings?|same[- ]day|next[- ]day|nafasi|tupo free)\b/i,
  comeWhen: /\b(we can come|we(?:'ll| will) (?:be there|come)|tunaweza kuja|tutakuja)\b.*\b(today|tomorrow|tonight|morning|afternoon|evening|\d|mon|tue|wed|thu|fri|sat|sun|leo|kesho|asubuhi|jioni|saa)/i,
  status: /\b(booked|confirmed|scheduled|reserved|arranged|logged|i'?ve (?:booked|noted|passed|sent|requested)|(?:will|'ll) (?:call|ring|phone|reach) you|someone will|team will|nimekubook|imethibitishwa|watakupigia|tumepanga|nimeweka)\b/i,
  hours: /\b(open|opens|close[sd]?|hours|daily|every day|kila siku|mon(?:day)?s?|tues?(?:day)?s?|wed(?:nesday)?s?|thu(?:rs)?(?:day)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?|weekends?|weekdays?|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\b/i,
  coverage: /\b(cover|covers|covered|coverage|serve|serves|service areas?|areas?|we come to|come to|reach|tunafika|mnafika|fika|maeneo|eneo)\b/i,
  payment: /\b(m-?pesa|pay ?bill|till|bank|cash|card|airtel|account (?:number|no)|lipa)\b/i,
  exists: /\b(we (?:also |do also |can also )?(?:do|offer|provide|have|can do)|tunafanya|tuna|tunatoa|yes,? we)\b/i,
  describe: /\b(involves?|includes?|including|we use|means|consists?|done by|process|steps?|first we|then we|we (?:wipe|scrub|vacuum|wash|dust|mop|remove|polish|sanitize|sanitise)|tuna(?:safisha|osha|fagia|piga deki))\b/i,
  price: /\b(ksh|kes|shillings?|bob|bei|price|prices|cost|costs|charge|charges|fee|elfu|mia)\b|\d/i,
  nameSaid: /\b(?:your name is|you(?:'re| are) called|i have you (?:down )?as|jina lako ni|nimekuandika kama)\s+([A-Z][a-z]+)/i,
  hedge: /\b(usually|around|about|probably|roughly|near|nearby|close to|approximately|karibu na)\b/i,
};
const CAP_OK = /^(January|February|March|April|May|June|July|August|September|October|November|December|Januari|Februari|Machi|Aprili|Mei|Juni|Julai|Agosti|Septemba|Oktoba|Novemba|Desemba|Jumatatu|Jumanne|Jumatano|Alhamisi|Ijumaa|Jumamosi|Jumapili|We|Our|Yes|No|And|The|For|You|Your|Done|Dusted|Shy|Sorry|Unfortunately|Okay|Currently|Right|Sure|That|This|There|What|Which|Would|Shall|Ndio|Ndiyo|Samahani|Sawa|Hapana|Tunafika|Hatufiki|Tuna|Hii|Kwa|Lakini|Great|Thanks|Thank|Also|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|English|Swahili|Paybill|Equity|Bank|Pesa)$/;
const STOP = new Set('kuanzia gharama ndiyo tunafanya tunatoa usafi huduma ungependa kubook mraba kwenye pamoja monday tuesday wednesday thursday friday saturday sunday today tomorrow morning afternoon evening works suits would booking currently right price prices costs priced starting starts square metre meter shillings what which please kindly great perfect alright sorry again unfortunately cover covered really actually indeed about after again also and any are because been before being both but can could did does doing done each from have having here into just like more most much only other our ours over same should some such than that their them then there these they this those through very what when where which while will with would your yours yes okay great sure thank thanks please clean cleaning cleaned service services offer offers provide will also team home house room rooms help happy glad'.split(' '));

function servicesNamed(sentence, note) {
  const low = ` ${String(sentence).toLowerCase().replace(/[^a-z ]/g, ' ')} `;
  const hits = [];
  for (const f of note.facts) if (f.family === 'service' && f.keys.length && f.keys.every((k) => low.includes(` ${k} `) || low.includes(` ${k}s `))) hits.push(f);
  // most specific match only (Interior Window Cleaning beats nothing else; "office" -> all office rows)
  return hits;
}

/**
 * @returns {{ verdict: 'pass'|'replace'|'drop', families: string[], reasons: string[] }}
 */
function verifySentence({ text, refs = [], kind = null, lang = null }, note, ctx = {}) {
  const s = String(text || '').trim();
  const reasons = []; const families = [];
  if (!s) return { verdict: 'drop', families, reasons: ['empty'] };
  const cited = (Array.isArray(refs) ? refs : []).map((r) => note.byId.get(String(r).replace(/[[\]\s]/g, ''))).filter(Boolean);
  // system-backed facts (resolved area, the booking the caller gave) count as cited: call state is the truth
  const auto = note.facts.filter((f) => f.auto);
  for (const f of auto) if (!cited.includes(f)) cited.push(f);
  const citedFam = (fam) => cited.filter((f) => f.family === fam);
  const booking = auto.find((f) => f.family === 'booking') || null;
  const offer = OFFER_Q.test(s);
  const neg = NEG.test(s);
  // language follows the caller: a clear wrong-language sentence is dropped
  if (ctx.replyLang === 'en' || ctx.replyLang === 'sw') {
    const d = L.detectLang(s); const want = ctx.replyLang;
    if ((want === 'en' && d.sw - d.en >= 2) || (want === 'sw' && d.en - d.sw >= 3 && d.sw === 0)) return { verdict: 'drop', families: ['language'], reasons: [`lang_mismatch:${want}`] };
  }
  // 1) availability: never from the model
  if ((RE.availability.test(s) || RE.comeWhen.test(s)) && !(offer && /\b(book|check|confirm|panga)\b/i.test(s))) { families.push('availability'); reasons.push('availability_only_via_booking_flow'); }
  // 2) booking / callback status: only a backend write id
  if (RE.status.test(s) && !offer) { families.push('status'); if (!citedFam('write').length) reasons.push('status_without_write_id'); }
  // 3) caller name
  const nm = s.match(RE.nameSaid);
  const known = citedFam('name')[0] || note.facts.find((f) => f.family === 'name');
  if (nm) { families.push('name'); if (!known || known.name.toLowerCase() !== nm[1].toLowerCase()) reasons.push('name_not_locked'); }
  for (const bad of (ctx.unlockedNames || [])) if (bad && !note.facts.some((f) => (f.keys || []).includes(String(bad).toLowerCase()) || (f.place || '').toLowerCase().includes(String(bad).toLowerCase())) && new RegExp(`\\b${bad.replace(/[^a-z]/gi, '')}\\b`, 'i').test(s)) { families.push('name'); reasons.push(`unlocked_name:${bad}`); }
  if (known && new RegExp(`\\b${known.name.replace(/[^a-z ]/gi, '')}\\b`, 'i').test(s) && !citedFam('name').length && !nm) { /* addressing a confirmed name is fine */ }
  // 4) area / coverage: the exact listed name, the right status, and no unlisted place word
  const place = N.matchArea(s, ctx.profile || {});
  const isQ = /\?\s*$/.test(s);
  if ((place && place.name) || (RE.coverage.test(s) && !offer && !isQ && !servicesNamed(s, note).length)) {
    families.push('area');
    if (place && place.name) {
      const f = citedFam('area').find((a) => a.place.toLowerCase() === String(place.name).toLowerCase() || (a.covered && a.county && a.county.toLowerCase() === String(place.name).toLowerCase()) || a.place.toLowerCase().endsWith(String(place.name).toLowerCase()));
      if (!f && booking && booking.place && String(booking.place).toLowerCase().includes(String(place.name).toLowerCase())) { /* the caller's own place, read back */ }
      else if (!f) reasons.push(`area_uncited:${place.name}`);
      else if (!s.toLowerCase().includes(f.place.toLowerCase())) reasons.push(`area_name_inexact:${f.place}`);
      else if (f.covered && neg && !offer) reasons.push('area_status_mismatch:covered_said_not');
      else if (!f.covered && !neg && !offer) reasons.push('area_status_mismatch:uncovered_said_yes');
    } else if (!citedFam('area').length) reasons.push('coverage_uncited');
    const known = [...(note.areas || []), ...citedFam('area').flatMap((a) => [a.place, a.county]), ...(booking && booking.place ? [booking.place] : [])].filter(Boolean).map((a) => a.toLowerCase());
    const caps = (s.match(/\b[A-Z][a-z]{3,}\b/g) || []).filter((w) => !CAP_OK.test(w) && !(booking && booking.words.includes(w.toLowerCase())) && !(note.facts.some((f) => (f.family === 'service' || f.family === 'business') && f.name.toLowerCase().includes(w.toLowerCase()))));
    for (const w of caps) if (!known.some((a) => a.split(/\s+/).includes(w.toLowerCase()))) reasons.push(`area_unlisted:${w}`);
  }
  // 5) services: existence + description
  const named = servicesNamed(s, note);
  const citedSvc = citedFam('service'); const citedPrice = citedFam('price');
  if (named.length) {
    families.push('service');
    const covered = named.filter((f) => citedSvc.some((c) => c.serviceId === f.serviceId) || citedPrice.some((c) => c.serviceId === f.serviceId) || (booking && booking.services.includes(f.name)));
    if (!covered.length) reasons.push('service_uncited');
    if (neg && RE.exists.test(s) && !offer) reasons.push('listed_service_denied');
  } else if (RE.exists.test(s) && !offer && !citedSvc.length && !citedFam('area').length && !citedFam('payment').length) {
    families.push('service'); reasons.push('service_claim_unlisted');
  }
  // description by default: any content word about a service that is not in its KB name/description
  const svcCtx = [...new Map([...citedSvc, ...named].map((f) => [f.id, f])).values()];
  if (svcCtx.length || RE.describe.test(s)) {
    const okWords = new Set(svcCtx.flatMap((f) => `${f.desc || ''} ${f.name}`.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)));
    if (booking) for (const w of [...booking.words, ...booking.services.join(' ').toLowerCase().split(/[^a-z]+/)]) okWords.add(w);
    for (const p of citedPrice) for (const w of p.text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)) okWords.add(w);
    const extra = s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 5 && !STOP.has(w) && !okWords.has(w) && !okWords.has(w.replace(/s$/, '')) && !okWords.has(w.replace(/ing$/, '')) && !okWords.has(`${w.replace(/s$/, '')}s`));
    const hasDesc = svcCtx.some((f) => f.desc);
    if (RE.describe.test(s) && !svcCtx.length && !offer) { families.push('description'); reasons.push('description_uncited'); }
    else if (extra.length > (hasDesc ? 2 : 0)) { families.push('description'); reasons.push(`${hasDesc ? 'description_unbacked' : 'description_none_on_file'}:${extra.slice(0, 4).join(',')}`); }
  }
  // 6) numbers / price / hours / payment: every number must come from a cited fact
  const nums = num(s);
  const sw = /\b(elfu|mia|laki)\b/i.test(s);
  if (sw) { families.push('price'); reasons.push('spoken_number_words'); }
  const bookingNumsOnly = !!booking && nums.length > 0 && nums.every((n) => booking.nums.includes(n));
  if (RE.hours.test(s) && !offer && !isQ && !bookingNumsOnly) { families.push('hours'); if (!citedFam('hours').length) reasons.push('hours_uncited'); }
  if (RE.payment.test(s) && !offer) { families.push('payment'); if (!citedFam('payment').length) reasons.push('payment_uncited'); }
  if (RE.price.test(s) && /\b(ksh|kes|shilling|bob|bei|price|cost|charge|fee)\w*/i.test(s) && !offer) { families.push('price'); if (!citedPrice.length && !nums.length) reasons.push('price_word_without_fact'); }
  if (nums.length) {
    families.push('number');
    const allowed = new Set([...cited.flatMap((f) => f.nums || []), ...named.flatMap((f) => num(f.name)), ...citedSvc.flatMap((f) => num(f.name))]);
    for (const n of nums) if (!allowed.has(n)) reasons.push(`number_unbacked:${n}`);
    // a price number must belong to the service the sentence names
    if (named.length && citedPrice.length && !citedPrice.some((p) => named.some((n) => n.serviceId === p.serviceId))) reasons.push('price_for_other_service');
  }
  if (RE.hedge.test(s) && families.length && !reasons.length && (families.includes('area') || families.includes('hours'))) reasons.push('hedged_fact');
  const fam = [...new Set(families)];
  if (reasons.length) return { verdict: 'replace', families: fam, reasons };
  if (kind === 'fact' && !fam.length && !cited.length) return { verdict: 'pass', families: fam, reasons: ['fact_kind_no_claim_found'] };
  return { verdict: 'pass', families: fam, reasons };
}

// [PROMPT-PLACEHOLDER] honest-unknown copy. Criteria (design §2.5): honest that we don't have the
// detail; never guess or hint a value; offer a callback (once per call) or the next step; <=20 words.
const UNKNOWN = {
  callback: { en: "I don't have that detail right now. Would you like the team to call you back with it?", sw: 'Sina taarifa hiyo kwa sasa. Ungependa timu ikupigie ikupe jibu?' },
  plain: { en: "I don't have that detail right now.", sw: 'Sina taarifa hiyo kwa sasa.' },
};
function unknownLine(lang, { callbackOffered = false } = {}) {
  const k = callbackOffered ? 'plain' : 'callback';
  return /^sw/.test(String(lang || '')) || lang === 'sheng' ? UNKNOWN[k].sw : UNKNOWN[k].en;
}
module.exports = { verifySentence, unknownLine, UNKNOWN, RE };
