'use strict';
// ONE owner-fact projection (audit 2026-10-25 B1). Every Brain answer path (v1 draft fact note, call
// core answers, model lead KB) and every fact checker reads the owner's policies and FAQs from here, so a
// topic the owner fills in on Desk reaches callers on every path or on none.
//
// Niche-agnostic: topics come from the stored data plus the per-trade registry (taxonomy.json
// policy_topics), never from a trade list. Sources, in order of precedence per topic:
//   1. business_policies.rules.<topic> with mode 'none' (or allowed:false / none:true) or 'custom'
//      (owner's own words in .note, Kiswahili in .note_sw; empty note_sw -> "Timu itathibitisha.")
//   2. the owner-confirmed text keys (payment, returns, delivery, cancellation, warranty, deposit, other,
//      and any extra text key), provenance-gated by factPolicyMap
//   3. business_policies.holds (owner hold rules)
// FAQs: owner-confirmed rows (factFaqs). Long text is split into sentences, never cut.
const TAX = require('../../data/taxonomy.json');
const { factPolicyMap, factFaqs, policyKeyLabel } = require('../provenance');

const SW_FALLBACK = 'Timu itathibitisha.';
// Rule topics Desk folds into another text key on save (policyRules.ts policyTextFromRules).
const TEXT_KEY_OF = { booking_changes: 'cancellation', no_show: 'cancellation' };
// Spoken wording lives in ONE place: Desk's registry writes business_policies.policy_lines.<topic> = { en, sw }
// on every save (docs/reference/platform/POLICIES.md). Brain speaks it word for word and keeps no copy of
// the wording, so the two can't drift. Only legacy rows with no policy_lines fall back to text keys.
// words a caller uses for a topic, beyond the words in its own label/detail (generic, not per trade)
const ALIASES = {
  payment: ['pay', 'payment', 'mpesa', 'm-pesa', 'cash', 'card', 'bank', 'paybill', 'till', 'lipa', 'malipo'],
  returns: ['return', 'returns', 'refund', 'refunds', 'exchange', 'rudisha', 'kurudisha'],
  delivery: ['deliver', 'delivery', 'shipping', 'courier', 'peleka', 'kuleta', 'mtaleta'],
  cancellation: ['cancel', 'cancellation', 'cancelling', 'ghairi', 'kughairi', 'kufuta'],
  booking_changes: ['move', 'reschedule', 'change the time', 'change my booking', 'badilisha', 'hamisha'],
  no_show: ['late', 'not home', 'no-show', 'no show', 'chelewa', 'nikichelewa'],
  warranty: ['warranty', 'guarantee', 'dhamana', 'waranti'],
  deposit: ['deposit', 'hold', 'reserve', 'booking fee', 'amana'],
  holds: ['hold', 'reserve', 'keep it for me', 'shikilia'],
  other: [],
};

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nums = (s) => String(s || '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) || [];
/** Split text into whole sentences (no length cut: the caller hears every sentence the owner saved). */
function sentences(text) {
  const t = clean(text); if (!t) return [];
  return (t.match(/[^.!?]+(?:[.!?](?:\d[^.!?]*)?)*?[.!?]+(?=\s|$)|[^.!?]+$/g) || [t]).map((x) => x.trim()).filter(Boolean);
}
function registryTopics() {
  return (TAX.policy_topics || []).map((t) => ({ id: t.id, label: t.label, detail: t.detail || '' }));
}
function labelOf(topic) {
  const r = registryTopics().find((t) => t.id === topic);
  return r ? r.label : policyKeyLabel(topic);
}
/** Words that ask about a topic: the generic alias list, or (a topic new to the registry) its own label words. */
function topicKeys(topic) {
  if (ALIASES[topic] && ALIASES[topic].length) return ALIASES[topic];
  return [...new Set(`${labelOf(topic)} ${topic.replace(/_/g, ' ')}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !['policy', 'other', 'booking', 'service', 'customer', 'rules', 'rule'].includes(w)))];
}
function ruleMode(r) {
  if (!r) return null;
  const m = String(r.mode || '').toLowerCase();
  if (m === 'custom') return 'custom';
  if (m === 'pickup_only') return 'pickup_only';
  if (m === 'none' || m === 'not_allowed' || r.allowed === false || r.none === true) return 'none';
  return null;
}
function holdsLine(h) {
  if (!obj(h)) return null;
  const confirmed = h.confirmed === true || String(h.source || '').toLowerCase() === 'owner';
  if (!confirmed) return null;
  const allowed = String(h.allowed ?? h.enabled ?? '').toLowerCase();
  if (allowed === 'no' || allowed === 'false') return { en: "We don't hold items.", sw: 'Hatushikilii bidhaa.' };
  if (allowed !== 'yes' && allowed !== 'true') return null;
  const hrs = Number(h.max_hours) > 0 ? Math.round(Number(h.max_hours)) : null;
  const dep = String(h.deposit_required || '').toLowerCase() === 'yes';
  return {
    en: `We can hold an item${hrs ? ` for up to ${hrs} hours` : ''}.${dep ? ' A deposit is needed.' : ''}`,
    sw: `Tunaweza kushikilia bidhaa${hrs ? ` hadi saa ${hrs}` : ''}.${dep ? ' Amana inahitajika.' : ''}`,
  };
}

/**
 * @param {object} profile tenant profile (businessPolicies, faqs, fieldMeta)
 * @returns {{ facts: Array<{id,family,topic,label,text,text_sw,sentences,nums,source,mode,keys}>, byTopic: Map, faqs: Array }}
 * family: 'payment' (id M1, kept for the v1 verifier), 'policy' (O1..), 'faq' (F1..).
 */
function ownerFacts(profile = {}) {
  const bp = obj(profile.businessPolicies) || {};
  const rules = obj(bp.rules) || {};
  const split = factPolicyMap(bp, profile.fieldMeta || null).policies;
  const facts = []; const byTopic = new Map();
  let o = 0;
  const add = (topic, en, sw, source, mode) => {
    const text = clean(en); if (!text && !sw) return;
    const family = topic === 'payment' ? 'payment' : 'policy';
    const id = family === 'payment' ? 'M1' : `O${++o}`;
    const label = labelOf(topic);
    const keys = topicKeys(topic);
    const f = { id, family, topic, label, text: text || SW_FALLBACK, text_sw: sw ? clean(sw) : null, sentences: sentences(text), nums: nums(`${text} ${sw || ''}`), source, mode: mode || 'text', keys };
    facts.push(f); byTopic.set(topic, f);
  };
  // topics: registry order, then any other rule topic, then text keys (payment first)
  const ruleTopics = [...new Set([...registryTopics().map((t) => t.id), ...Object.keys(rules)])];
  const textKeys = Object.keys(split).filter((k) => k !== 'coverage_areas');
  const order = [...new Set(['payment', ...ruleTopics, ...textKeys])];
  const lines = obj(bp.policy_lines) || {};
  const usedText = new Set();
  for (const topic of order) {
    const r = obj(rules[topic]); const mode = ruleMode(r);
    // 1. Desk's final spoken line for this topic (every option, en + sw). Each topic reads only its own line.
    const pl = obj(lines[topic]);
    if (pl && (clean(pl.en) || clean(pl.sw))) {
      add(topic, clean(pl.en) || SW_FALLBACK, clean(pl.sw) || SW_FALLBACK, 'policy_line', mode || (r ? 'rule' : 'line'));
      continue;
    }
    if (mode === 'custom') {
      const en = clean(r.note); const sw = clean(r.note_sw);
      if (en || sw) { add(topic, en || SW_FALLBACK, sw || SW_FALLBACK, 'rule', 'custom'); continue; }
    }
    // 2. legacy rows (saved before policy_lines): a neutral line for 'none', else the topic's own text key.
    if (mode === 'none') { add(topic, `We don't offer ${labelOf(topic).toLowerCase()}.`, SW_FALLBACK, 'rule', 'none'); continue; }
    // a Desk-era joined text key (cancellation = Cancel + Move + Late) is not this topic's own answer when
    // this topic has no rule but a folded topic has its own line (e.g. only Late set -> cancellation unset).
    const joinedOnly = !r && Object.entries(TEXT_KEY_OF).some(([t, h]) => h === topic && obj(lines[t]));
    const key = split[topic] != null && !joinedOnly ? topic : null;
    if (key && !usedText.has(key)) { usedText.add(key); add(topic, String(split[key]), null, 'text', mode || 'text'); continue; }
    if (mode === 'pickup_only') { add(topic, 'Pickup only. Customers collect from us.', SW_FALLBACK, 'rule', 'pickup_only'); continue; }
    // 3. a folded topic (booking_changes, no_show) with NO rule of its own may answer from its host's legacy
    // joined text. Never from a host rule line: Cancel=No must not answer Move or Late (Desk review of #937).
    const host = TEXT_KEY_OF[topic];
    if (!r && host && byTopic.has(host) && !byTopic.has(topic) && byTopic.get(host).source === 'text' && byTopic.get(host).mode === 'text') {
      const hf = byTopic.get(host);
      hf.keys = [...new Set([...hf.keys, ...topicKeys(topic)])];
      byTopic.set(topic, hf);
    }
  }
  const hl = holdsLine(bp.holds);
  if (hl && !byTopic.has('holds')) add('holds', hl.en, hl.sw, 'holds', 'rule');
  const faqs = factFaqs(profile.faqs, profile.fieldMeta || null).slice(0, 30);
  faqs.forEach((q, i) => {
    const text = `Q: ${clean(q.question)} A: ${clean(q.answer)}`;
    const keys = clean(q.question).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    facts.push({ id: `F${i + 1}`, family: 'faq', topic: `faq:${i + 1}`, label: clean(q.question), question: clean(q.question), answer: clean(q.answer), text, text_sw: null, sentences: sentences(q.answer), nums: nums(q.answer), source: 'faq', mode: 'text', keys });
  });
  return { facts, byTopic, faqs: facts.filter((f) => f.family === 'faq') };
}

/** The spoken answer for one fact in the caller's language. No Kiswahili text -> the team-confirm line. */
function spoken(f, lang) {
  if (!f) return null;
  const sw = /^sw/.test(String(lang || '')) || lang === 'sheng';
  if (f.family === 'faq') return sw ? (f.text_sw || SW_FALLBACK) : f.answer;
  return sw ? (f.text_sw || SW_FALLBACK) : f.text;
}

/** Facts the caller's words ask about (policy topic words or a FAQ question's words). */
function match(text, of) {
  const low = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9\- ]/g, ' ').replace(/\s+/g, ' ')} `;
  const hits = [];
  for (const [topic, f] of of.byTopic) if ((f.keys || []).some((k) => low.includes(` ${k} `) || low.includes(` ${k}s `) || (k.length >= 6 && low.includes(k)))) { if (!hits.includes(f)) hits.push(f); void topic; }
  for (const f of of.faqs) {
    const hit = f.keys.filter((k) => low.includes(k)).length;
    if (f.keys.length && hit >= Math.min(2, f.keys.length)) hits.push(f);
  }
  return hits;
}

const POLICY_WORD = /\b(cancel\w*|refund\w*|return\w*|exchange\w*|warrant\w*|guarantee\w*|deliver\w*|deposit\w*|late|no[- ]show|reschedul\w*|ghairi|dhamana|rudisha|peleka|amana)\b/i;
const NOT_POLICY = /\b(cancelled|canceled|rescheduled|moved it|booked|your booking|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?|january|february|march|april|may|june|july|august|september|october|november|december|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili|\d{1,2}(:\d{2})?\s*(am|pm)|saa \w+)\b/i;
/**
 * Shared fact check for policy sentences (used by every path's checker): a sentence about a policy topic
 * that states a number must take that number from an owner fact. Returns null (fine) or
 * { reason, fix } with the owner's own sentence for that topic.
 */
function checkPolicySentence(s, of, lang) {
  const t = String(s || '');
  if (!POLICY_WORD.test(t)) return null;
  // a booking read-back / status line (dates, times, done actions) is the call state's, not a policy claim
  if (NOT_POLICY.test(t)) return null;
  const n = nums(t); if (!n.length) return null;
  const hits = match(t, of).filter((f) => f.family !== 'faq');
  const allowed = new Set(of.facts.flatMap((f) => f.nums));
  const bad = n.filter((x) => !allowed.has(x));
  if (!bad.length) return null;
  const f = hits[0];
  return { reason: `policy_number_unbacked:${bad.join(',')}`, fix: f ? spoken(f, lang) : (/^sw/.test(String(lang || '')) ? SW_FALLBACK : "I'm not sure about that; I can have the team confirm.") };
}

/** The owner fact a numbered sentence restates: every number is in it and it shares two content words. */
function backingFact(s, of) {
  const n = nums(s); if (!n.length) return null;
  const words = new Set(String(s).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));
  return of.facts.find((f) => n.every((x) => f.nums.includes(x)) && `${f.text} ${f.text_sw || ''}`.toLowerCase().split(/[^a-z]+/).filter((w) => words.has(w)).length >= 2) || null;
}

/**
 * The ONE payment fact (methods + deposit) every path speaks and every checker reads. Built from the owner's
 * payment line, plus the deposit line only when the payment line does not already state it (no stitching:
 * callers hear the owner's own sentences, never "We take You can pay by ..."). null when no payment fact.
 */
function paymentFact(of) {
  const pay = of.byTopic.get('payment'); const dep = of.byTopic.get('deposit');
  if (!pay && !dep) return null;
  const has = (f, g) => g && f && g.nums.length && g.nums.every((n) => f.nums.includes(n));
  const parts = [pay, dep && !has(pay, dep) ? dep : null].filter(Boolean);
  const en = parts.map((f) => f.text).join(' ');
  const swParts = parts.map((f) => f.text_sw).filter(Boolean);
  return { id: 'M1', topic: 'payment', en, sw: swParts.length === parts.length ? swParts.join(' ') : (swParts[0] || SW_FALLBACK), sentences: sentences(en), sentences_sw: sentences(swParts.join(' ')), nums: [...new Set(parts.flatMap((f) => f.nums))] };
}
function paymentLine(profile, lang) { const f = paymentFact(ownerFacts(profile)); if (!f) return null; return /^sw/.test(String(lang || '')) ? f.sw : f.en; }

/** Compact KB rows for a model prompt: { topic: text } + FAQs. */
function kbRows(of) {
  const policies = {};
  for (const f of of.facts) if (f.family !== 'faq') policies[f.topic] = f.text_sw && f.mode !== 'text' ? { en: f.text, sw: f.text_sw } : f.text;
  return { policies, faqs: of.faqs.map((f) => ({ q: f.question, a: f.answer })) };
}

module.exports = { paymentFact, paymentLine, backingFact, ownerFacts, spoken, match, checkPolicySentence, kbRows, sentences, registryTopics, SW_FALLBACK, TEXT_KEY_OF };
