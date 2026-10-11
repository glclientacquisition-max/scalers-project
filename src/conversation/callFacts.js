'use strict';

/**
 * Per-call structured record (public.call_facts) from the post-call review.
 * One taxonomy for shops and home services: src/data/taxonomy.json (same file the desk uses).
 * Owner corrections (source=owner) are trusted and never overwritten by a later review.
 */
const taxonomy = require('../data/taxonomy.json');

const ids = (list) => new Set(list.map((o) => o.id));
const INTENTS = ids(taxonomy.intents);
const OUTCOMES = ids(taxonomy.outcomes);
const LOST = ids(taxonomy.lost_reasons);
const SENTIMENTS = ids(taxonomy.sentiments);
const LANGS = ids(taxonomy.languages);

function canonicalIntent(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (INTENTS.has(v)) return v;
  return taxonomy.legacy_intents[v] || 'other';
}

function pick(set, raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return set.has(v) ? v : null;
}

function ksh(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? Math.round(n) : null;
}

function shortText(raw, max) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^(none|null|n\/a|unknown)$/i.test(s)) return null;
  return s.slice(0, max);
}

const words = (text) => String(text || '').toLowerCase().match(/[a-z']+/g) || [];

/**
 * Caller-side language from marker words. Model answer wins when valid; this is the fallback
 * and the tie-break for Sheng (models tend to call Sheng "Swahili").
 */
function detectLanguage(callerText) {
  const w = words(callerText);
  if (w.length < 3) return null;
  const text = ` ${w.join(' ')} `;
  const has = (list) => list.reduce((n, m) => n + (text.includes(` ${m} `) ? 1 : 0), 0);
  const sheng = has(taxonomy.sheng_markers);
  const sw = has(taxonomy.swahili_markers);
  const en = w.filter((x) => ['the', 'is', 'are', 'you', 'i', 'want', 'how', 'much', 'do', 'have', 'please', 'can', 'what'].includes(x)).length;
  if (sheng >= 2) return 'sheng';
  if (sw >= 2 && en >= 2) return 'mixed';
  if (sw >= 2) return 'sw';
  if (en >= 2) return sheng || sw ? 'mixed' : 'en';
  return null;
}

function timeParts(at, tz = 'Africa/Nairobi') {
  const d = new Date(at || Date.now());
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, weekday: 'short', timeZone: tz });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const bucket = taxonomy.time_of_day.find((b) => hour >= b.from && hour < b.to) || taxonomy.time_of_day[0];
  return { hour_eat: hour, dow, time_of_day: bucket.id };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Match a mentioned product to the tenant catalogue by name/alias (exact, then contains). */
function matchCatalogue(rawName, catalogue) {
  const n = norm(rawName);
  if (!n || !Array.isArray(catalogue)) return null;
  let best = null;
  for (const item of catalogue) {
    const names = [item?.name, ...(Array.isArray(item?.aliases) ? item.aliases : [])].map(norm).filter(Boolean);
    if (names.includes(n)) return item;
    if (!best && names.some((x) => x.length >= 4 && (x.includes(n) || n.includes(x)))) best = item;
  }
  return best;
}

function catalogueKey(item) {
  return String(item?.id || item?.sku || '').trim() || norm(item?.name);
}

/** Review JSON `facts` -> clean values. Unknown enums become null, never a guess. */
function normalizeCallFacts(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const outcome = pick(OUTCOMES, f.outcome);
  const products = (Array.isArray(f.products_mentioned) ? f.products_mentioned : [])
    .slice(0, 10)
    .map((p) => ({
      name: shortText(p?.name ?? p, 80),
      qty: Number.isInteger(Number(p?.qty)) && Number(p.qty) > 0 && Number(p.qty) < 10000 ? Number(p.qty) : null,
      quoted_price_ksh: ksh(p?.quoted_price_ksh),
    }))
    .filter((p) => p.name);
  const secondary = (Array.isArray(f.secondary_intents) ? f.secondary_intents : [])
    .map(canonicalIntent)
    .filter((x) => x && x !== 'other');
  return {
    intent: canonicalIntent(f.intent),
    secondary_intents: [...new Set(secondary)].slice(0, 4),
    outcome,
    lost_reason: outcome === 'lost' ? pick(LOST, f.lost_reason) || 'other' : null,
    products_mentioned: products,
    price_objection: typeof f.price_objection === 'boolean' ? f.price_objection : null,
    objection_price_ksh: ksh(f.objection_price_ksh),
    competitor_mentioned: shortText(f.competitor_mentioned, 80),
    est_value_ksh: ksh(f.est_value_ksh),
    caller_area: shortText(f.caller_area, 80),
    language: pick(LANGS, f.language),
    sentiment: pick(SENTIMENTS, f.sentiment),
    unanswered_question: shortText(f.unanswered_question, 300),
  };
}

/** Row for public.call_facts. Products are linked to catalogue items when they match. */
function buildCallFactsRow({ call, facts, review, callerText, catalogue, model = null } = {}) {
  const f = facts || normalizeCallFacts(null);
  const lang = f.language && f.language !== 'sw' ? f.language : detectLanguage(callerText) || f.language;
  const products = f.products_mentioned.map((p) => {
    const hit = matchCatalogue(p.name, catalogue);
    const listed = Number(hit?.pricing?.amount_ksh);
    return {
      ...p,
      catalogue_key: hit ? catalogueKey(hit) : null,
      listed_price_ksh: Number.isFinite(listed) && listed > 0 ? listed : null,
    };
  });
  let est = f.est_value_ksh;
  if (est == null && products.length && ['sale_or_order', 'hold', 'lost'].includes(f.outcome)) {
    const sum = products.reduce((n, p) => n + (p.quoted_price_ksh ?? p.listed_price_ksh ?? 0) * (p.qty || 1), 0);
    est = sum > 0 ? sum : null;
  }
  return {
    call_id: call.id,
    tenant_id: call.tenant_id,
    created_at: call.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    intent: f.intent || canonicalIntent(review?.primary_intent),
    secondary_intents: f.secondary_intents,
    outcome: f.outcome,
    lost_reason: f.lost_reason,
    products_mentioned: products,
    price_objection: f.price_objection,
    objection_price_ksh: f.objection_price_ksh,
    competitor_mentioned: f.competitor_mentioned,
    est_value_ksh: est,
    caller_area: f.caller_area,
    language: lang || null,
    sentiment: f.sentiment,
    unanswered_question: f.unanswered_question,
    ...timeParts(call.created_at),
    source: 'review',
    model,
    confidence: typeof review?.confidence === 'number' ? review.confidence : null,
  };
}

/** Keep owner-corrected intent/outcome/lost_reason; refresh everything else. */
function mergeWithExisting(row, existing) {
  if (!existing || existing.source !== 'owner') return row;
  return {
    ...row,
    intent: existing.intent,
    outcome: existing.outcome,
    lost_reason: existing.lost_reason,
    source: 'owner',
    owner_corrected_by: existing.owner_corrected_by,
    owner_corrected_at: existing.owner_corrected_at,
    review_snapshot: { intent: row.intent, outcome: row.outcome, lost_reason: row.lost_reason, source: 'review' },
  };
}

module.exports = {
  buildCallFactsRow,
  canonicalIntent,
  detectLanguage,
  matchCatalogue,
  mergeWithExisting,
  normalizeCallFacts,
  timeParts,
  taxonomy,
};
