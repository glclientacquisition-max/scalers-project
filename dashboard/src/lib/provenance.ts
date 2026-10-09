/* eslint-disable @typescript-eslint/no-explicit-any */
// Compile twin of src/conversation/provenance.js.
// Next turbopack root is the dashboard package, so this file does not import
// src/conversation or src/db. Keep behavior lockstep with the JS module.
// Pass fieldMeta from listTenantFieldMeta and holdGate from getTenantHoldGate
// (dashboard/src/lib/tenantFieldProvenance.ts or src/db.js). Pack text remains
// the fallback when those rows or the RPC are missing. This file stays free of
// server imports so the compile twin can run under node and in the client graph.

// Provenance adapter for compile and live ground truth.
//
// When tenant_field_meta rows are loaded (profile.fieldMeta / compile fieldMeta),
// that source wins for the field_path. Pack-text matching is only the fallback
// for a path with no meta row, or when the table is absent (prod before the
// Platform migration). Unmarked text that is not a pack seed stays owner on
// that fallback so existing owner-typed rows keep working.
//
// Hold placement uses profile.holdGate from tenant_hold_gate when the RPC
// answered. provenance_rpc_missing falls back to the catalogue + hold-rule check.
//
// Only owner, or an explicit confirm, is fact. seed and call_suggested cap at
// suggested and never compile or speak as GOLDEN. import and inferred are not
// fact until confirmed. Empty policy text is unknown. Never invent a default.
//
// Confirm v2 (value_hash), behind FACT_HASH_MODE (on only when exactly 'on').
// Hash mode off: the P0 rules above, exactly. Hash mode on: a path is fact only
// when its tenant_field_meta row exists with source = 'owner' AND value_hash ===
// hashFactValue(current value). No meta row, a missing value_hash (or column),
// or any in-data source/confirmed hint is not confirmed.
// This file is in the client graph, so it never reads process.env. Hash mode
// comes from an explicit { hashMode } option or a hashMode set on the indexed
// fieldMeta (server helpers set it from FACT_HASH_MODE); otherwise it is off.

import {
  hashFactValue,
  catalogRowFactValue,
  faqFactValue,
  holdsFactValue,
  stableRowId,
} from './factHash';

export const SOURCES = new Set(['owner', 'seed', 'import', 'inferred', 'call_suggested']);

export function norm(value: any) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact pack FAQ question + answer pairs (retail and home starters). */
const PACK_FAQ_PAIRS = [
  [
    'What are your opening hours?',
    'We are open Monday to Saturday. Confirm the exact times in Train if they differ.',
  ],
  [
    'Where are you located?',
    'Share your shop landmark and street in Train so callers get accurate directions.',
  ],
  [
    'Do you accept M-Pesa?',
    'Yes, we accept M-Pesa. You can pay on pickup or delivery as arranged.',
  ],
  [
    'Can you hold an item for me?',
    'Yes. Tell us the item, your name, and when you will pick up, and we will log a hold.',
  ],
  [
    'Do you deliver?',
    'Yes. Same-day in Nairobi for stocked items when available, and countrywide shipping.',
  ],
  [
    'Can you source a book that is not in stock?',
    'Yes. Request the title and we will source it, usually with a free quotation first.',
  ],
  [
    'What are your opening hours?',
    'We take calls during business hours. Confirm exact times in Train if they differ.',
  ],
  [
    'Do you come to my location?',
    'Yes. We visit clients in our service area. Share your landmark when booking.',
  ],
  [
    'Which areas do you cover?',
    'We cover our listed service areas. Outside coverage we may decline or note a callback honestly.',
  ],
  [
    'How much does a visit cost?',
    'Many jobs are quoted on site from the price band in Train. We never invent a fixed price.',
  ],
  [
    'Can I book a visit over the phone?',
    'Yes. Tell us the service, your name, preferred time window, and landmark.',
  ],
  [
    'Do you clean carpets, couches, or mattresses?',
    'If those jobs are listed in Train, we book them as visits. If not listed, we say so and can note an enquiry.',
  ],
  [
    'Can I get the same day?',
    'If we are open and the time is inside hours, we can take the visit. We do not invent a travel ETA.',
  ],
  [
    'What if it is an emergency?',
    'Burst pipes, flooding, fire, gas, or shock go to the team at once. Same-day cleaning is a normal visit.',
  ],
];

const PACK_FAQ_KEYS = new Set(
  PACK_FAQ_PAIRS.map(([question, answer]) => `${norm(question)}\n${norm(answer)}`)
);

/** Exact starter policy sentences. Empty is unknown; these are not facts. */
const PACK_POLICY_TEXTS = [
  'M-Pesa and cash. Confirm other methods with the team if asked.',
  'Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.',
  'We can hold items for pickup when we have the caller name and pickup time.',
  'Returns and exchanges follow shop policy. Confirm details with the team if unsure.',
  'Prices vary by title; special orders get a free quotation before you confirm.',
  'M-Pesa and cash after the visit unless agreed otherwise.',
  'We come to you within our service area. Confirm coverage in Train.',
  'Some jobs may need a booking deposit. Confirm with the team.',
  'Call ahead to reschedule or cancel. Same-day cancels may be noted for the team.',
  'Workmanship follows the job quote. Confirm details on site.',
  'True emergencies (burst, flood, fire, gas, shock) are prioritized when the team is available.',
];

const PACK_POLICY_KEYS = new Set(PACK_POLICY_TEXTS.map(norm));

/** name, price_range, notes for vertical-pack service rows. */
const PACK_SERVICES = [
  ['In-store & online sales', '', 'Browse and buy stocked items.'],
  ['Special orders / sourcing', 'Free quotation', 'Source hard-to-find titles on request.'],
  ['Delivery', '', 'Local and countrywide delivery when available.'],
  ['Home cleaning', 'Quoted on site', 'House, Airbnb, and general clean visits.'],
  ['Carpet, upholstery, mattress', 'Quoted on site', 'Couch, carpet, mattress, and fabric cleans.'],
  ['General repair / maintenance visit', 'Quoted on site', 'Diagnose and fix common household issues.'],
  ['Installation', 'Quoted on site', 'Install fixtures or equipment as listed in Train.'],
  ['Inspection / assessment', 'Quoted on site', 'On-site assessment before larger jobs.'],
];

const PACK_SERVICE_KEYS = new Set(
  PACK_SERVICES.map(([name, price, notes]) => `${norm(name)}\n${norm(price)}\n${norm(notes)}`)
);

export const POLICY_TOPICS = {
  payment: 'Payment',
  returns: 'Returns',
  delivery: 'Delivery',
  deposit: 'Holds',
  cancellation: 'Cancellation',
  warranty: 'Warranty',
  other: 'Other policy',
};

export function asArray(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function asObject(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

export function envelopeOf(row: any): Record<string, any> {
  if (!row || typeof row !== 'object') return {};
  const nested = row.envelope || row.field_meta || row.meta;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  return row;
}

export function readSource(row: any) {
  const env = envelopeOf(row);
  const raw = String(env.source || env.provenance || '').trim().toLowerCase();
  return SOURCES.has(raw) ? raw : '';
}


/** Hash mode for one call: explicit option, then fieldMeta.hashMode, else off. */
export function resolveHashMode(explicit?: unknown, fieldMeta?: any): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (typeof explicit === 'string') return explicit === 'on';
  if (fieldMeta && typeof fieldMeta.hashMode === 'boolean') return fieldMeta.hashMode;
  return false;
}

/** Pin hash mode on a fieldMeta index (null stays null when off). */
export function withHashMode(fieldMeta: any, hashMode?: boolean): any {
  if (typeof hashMode !== 'boolean') return fieldMeta;
  if (!fieldMeta) return hashMode ? { loaded: false, hashMode: true, byPath: {} } : null;
  return { ...fieldMeta, hashMode };
}

/** In-data envelope confirm (P0). In hash mode in-data hints never confirm. */
export function isConfirmed(row: any, { hashMode }: { hashMode?: boolean | string } = {}) {
  if (resolveHashMode(hashMode)) return false;
  const env = envelopeOf(row);
  if (env.confirmed === true) return true;
  if (env.confirmed_by) return true;
  if (env.confirmed_at) return true;
  return false;
}

export function isPackFaq(question: any, answer: any) {
  return PACK_FAQ_KEYS.has(`${norm(question)}\n${norm(answer)}`);
}

export function isPackPolicyText(text: any) {
  return PACK_POLICY_KEYS.has(norm(text));
}

export function isPackService(row: any) {
  if (!row || typeof row !== 'object') return false;
  const price = row.price_range || row.priceRange || row.price || '';
  return PACK_SERVICE_KEYS.has(`${norm(row.name)}\n${norm(price)}\n${norm(row.notes)}`);
}

/**
 * Index rows from tenant_field_meta. Null means the table was not loaded
 * (heuristic for every path). An empty byPath means the table answered and
 * this tenant has no rows, so each missing path still uses the heuristic.
 * @param {Array<{ field_path?: string, source?: string }>|null|undefined} rows
 */
export function indexFieldMeta(rows: any, { hashMode }: { hashMode?: boolean } = {}) {
  if (!Array.isArray(rows)) {
    // Hash mode with no table loaded: every path is unconfirmed, so carry the
    // mode on an empty index instead of returning null (null = P0 heuristic).
    return hashMode === true ? { loaded: false, hashMode: true, byPath: {} } : null;
  }
  const byPath: Record<string, any> = {};
  for (const row of rows) {
    const path = String(row?.field_path || row?.fieldPath || '').trim();
    const source = String(row?.source || '').trim().toLowerCase();
    if (!path || !SOURCES.has(source)) continue;
    byPath[path] = {
      source,
      confirmed_at: row.confirmed_at || row.confirmedAt || null,
      confirmed_by: row.confirmed_by || row.confirmedBy || null,
    };
    // GIGO P2 freshness. Kept only when the select returned them.
    const verified = row.last_verified_at || row.lastVerifiedAt;
    if (verified) byPath[path].last_verified_at = verified;
    const staleDays = Number(row.stale_after_days ?? row.staleAfterDays);
    if (Number.isFinite(staleDays) && staleDays > 0) byPath[path].stale_after_days = staleDays;
    // Confirm v2. Read only in hash mode; a row without it is unconfirmed there.
    const hash = String(row.value_hash || row.valueHash || '').trim().toLowerCase();
    if (hash) byPath[path].value_hash = hash;
  }
  const out: Record<string, any> = { loaded: true, byPath };
  if (typeof hashMode === 'boolean') out.hashMode = hashMode;
  return out;
}

export function lookupFieldMeta(fieldMeta: any, fieldPath: any) {
  if (!fieldMeta || !fieldPath) return null;
  const byPath = fieldMeta.byPath && typeof fieldMeta.byPath === 'object' ? fieldMeta.byPath : null;
  if (!byPath) return null;
  const hit = byPath[fieldPath];
  if (!hit || !SOURCES.has(hit.source)) return null;
  return hit;
}

export function productFieldPath(row: any, index: any) {
  const sku = String(row?.sku || '').trim();
  return `catalog.product.${sku || String(index + 1)}.name`;
}

/** Stable id (non-numeric) when the row has one, else the 1-based position. */
export function serviceFieldPath(index: any, row: any = null) {
  const id = stableRowId(row);
  return `catalog.service.${id || String(index + 1)}.name`;
}

export function faqFieldPath(index: any) {
  return `faqs.${index + 1}`;
}

/**
 * @returns {{ source: string, confirmed: boolean, fact: boolean, status: string }}
 * fact is only owner or an explicit confirm. seed and call_suggested are never fact.
 * A tenant_field_meta row for fieldPath replaces the pack-text guess.
 */
export function classifyRecord(row: any, { packSeed = false, fieldMeta = null, fieldPath = '', value, hashMode }: any = {}) {
  const meta = lookupFieldMeta(fieldMeta, fieldPath);
  if (resolveHashMode(hashMode, fieldMeta)) {
    if (!meta) return { source: '', confirmed: false, fact: false, status: 'suggested', hashCheck: 'no_row' };
    const hash = meta.value_hash || null;
    const matches =
      meta.source === 'owner' && Boolean(hash) && value !== undefined && hash === hashFactValue(value);
    const hashCheck = !hash ? 'missing' : matches ? 'match' : 'mismatch';
    let status = 'suggested';
    if (matches) {
      const raw = String(envelopeOf(row).status || '').trim().toLowerCase();
      status = raw === 'golden' ? 'golden' : 'confirmed';
    }
    return { source: meta.source, confirmed: matches, fact: matches, status, hashCheck };
  }
  let working = row;
  let seed = packSeed;
  if (meta) {
    const metaConfirmed = meta.source === 'owner' || Boolean(meta.confirmed_at || meta.confirmed_by);
    working = {
      ...(row && typeof row === 'object' ? row : {}),
      source: meta.source,
      confirmed: metaConfirmed,
      confirmed_at: meta.confirmed_at || undefined,
      confirmed_by: meta.confirmed_by || undefined,
    };
    seed = false;
  }
  const confirmed = isConfirmed(working, { hashMode: false });
  let source = readSource(working);
  if (!source && seed) source = 'seed';
  if (!source && confirmed) source = 'owner';
  if (!source) source = 'owner';

  const blocked = source === 'seed' || source === 'call_suggested' || source === 'inferred';
  const importPending = source === 'import' && !confirmed;
  const fact = !blocked && !importPending && (source === 'owner' || confirmed);

  let status = 'suggested';
  if (fact) {
    const raw = String(envelopeOf(working).status || '').trim().toLowerCase();
    status = raw === 'golden' && (source === 'owner' || confirmed) ? 'golden' : 'confirmed';
  }
  return { source, confirmed, fact, status };
}

export function classifyFaq(faq: any, fieldMeta: any = null, fieldPath: any = '') {
  const question = String(faq?.question || '').trim();
  const answer = String(faq?.answer || '').trim();
  const packSeed = isPackFaq(question, answer);
  const row = classifyRecord(faq, { packSeed, fieldMeta, fieldPath, value: faqFactValue(faq) });
  return { ...row, question, answer };
}

export function classifyPolicyValue(text: any, meta: any, fieldMeta: any = null, fieldPath: any = '') {
  const value = String(text || '').trim();
  if (!value) return { source: '', confirmed: false, fact: false, status: 'suggested', empty: true };
  const packSeed = isPackPolicyText(value);
  const base = meta && typeof meta === 'object' && Object.keys(meta).length
    ? meta
    : { source: packSeed ? 'seed' : '' };
  return {
    ...classifyRecord(base, { packSeed, fieldMeta, fieldPath, value: text }),
    empty: false,
    text: value,
  };
}

export function policyMeta(policies: any, key: any) {
  const obj = asObject(policies);
  if (obj.provenance && typeof obj.provenance === 'object') return obj.provenance[key] || {};
  if (obj.field_meta && typeof obj.field_meta === 'object') return obj.field_meta[key] || {};
  const direct = obj[`${key}_source`] || obj[`${key}Source`];
  if (direct) return { source: direct };
  if (SOURCES.has(String(obj.source || '').toLowerCase())) return { source: obj.source };
  return {};
}

// Keys in business_policies that are metadata or are read by a gate of their
// own (holds -> request tools, booking_mode -> confirmed slots). They are not
// spoken policy text. Lockstep with src/conversation/provenance.js.
const POLICY_META_KEYS = new Set([
  'provenance',
  'field_meta',
  'source',
  'holds',
  'holds_allowed',
  'booking',
  'booking_meta',
  'booking_mode',
  'bookingMode',
  'coverage_areas',
]);

export function isPolicyMetaKey(key: any) {
  if (POLICY_META_KEYS.has(key)) return true;
  return /(_source|Source|_meta|_confirmed|_at)$/.test(key);
}

export function policyKeyLabel(key: any) {
  const words = String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

// coverage_areas ids ("county:nairobi", "place:kitengela"). The server checks
// each id against the place index (src/conversation/coverageAreas.js); this
// file stays import-free, so it keeps the same shape without the index.
function coverageAreaIds(obj: any): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(obj, 'coverage_areas')) return null;
  if (!Array.isArray(obj.coverage_areas)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of obj.coverage_areas) {
    const id = String(item || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const split = id.indexOf(':');
    if (split < 1) continue;
    const kind = id.slice(0, split);
    if (kind !== 'county' && kind !== 'place') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Split business_policies into what the prompt may state and what it must
 * call unknown. Every configured key lands on one side; none is dropped.
 * coverage_areas is the settings picker list; the prompt carries the same list
 * the voice path answers coverage from.
 */
export function factPolicyMap(policies: any, fieldMeta: any = null) {
  const obj = asObject(policies);
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [key, label] of Object.entries(POLICY_TOPICS)) {
    const text = String(obj[key] || '').trim();
    const row = classifyPolicyValue(text, policyMeta(obj, key), fieldMeta, `policies.${key}`);
    if (row.fact) out[key] = text;
    else unknown.push(label);
  }
  const coverage = coverageAreaIds(obj);
  if (coverage) out.coverage_areas = coverage;
  for (const [key, raw] of Object.entries(obj)) {
    if (Object.prototype.hasOwnProperty.call(POLICY_TOPICS, key) || isPolicyMetaKey(key)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const text = String(raw).trim();
    if (!text) continue;
    const row = classifyPolicyValue(text, policyMeta(obj, key), fieldMeta, `policies.${key}`);
    if (row.fact) out[key] = text;
    else unknown.push(policyKeyLabel(key));
  }
  return { policies: out, unknown };
}

const HOLD_DENIAL =
  /\b(no holds?|do not hold|don't hold|cannot hold|can't hold|not holding|hatuweki|hatutoi hold)\b/i;

export function holdRulesAllow(policies: any, fieldMeta: any = null) {
  const obj = asObject(policies);
  const holds = obj.holds;
  if (holds && typeof holds === 'object') {
    const allowed = String(holds.allowed ?? holds.enabled ?? '').trim().toLowerCase();
    const row = classifyRecord(holds, {
      packSeed: false,
      fieldMeta,
      fieldPath: 'policies.holds',
      value: holdsFactValue(obj),
    });
    if (allowed === 'no' || allowed === 'false') return false;
    if ((allowed === 'yes' || allowed === 'true') && row.fact) return true;
  }
  const deposit = String(obj.deposit || '').trim();
  const row = classifyPolicyValue(deposit, policyMeta(obj, 'deposit'), fieldMeta, 'policies.deposit');
  if (!row.fact) return false;
  if (HOLD_DENIAL.test(deposit)) return false;
  return true;
}

export function factProducts(raw: any, fieldMeta: any = null) {
  return asArray(raw).filter((row, index) => {
    if (!row || typeof row !== 'object') return false;
    if (!String(row.name || '').trim()) return false;
    return classifyRecord(row, {
      packSeed: false,
      fieldMeta,
      fieldPath: productFieldPath(row, index),
      value: catalogRowFactValue(row),
    }).fact;
  });
}

export function factServices(raw: any, fieldMeta: any = null) {
  return asArray(raw).filter((row, index) => {
    if (!row || typeof row !== 'object') return false;
    if (!String(row.name || '').trim()) return false;
    return classifyRecord(row, {
      packSeed: isPackService(row),
      fieldMeta,
      fieldPath: serviceFieldPath(index, row),
      value: catalogRowFactValue(row),
    }).fact;
  });
}

export function factFaqs(raw: any, fieldMeta: any = null) {
  return asArray(raw)
    .map((faq, index) => classifyFaq(faq, fieldMeta, faqFieldPath(index)))
    .filter((row) => row.fact && row.question && row.answer);
}

export function unknownFaqTopics(raw: any, fieldMeta: any = null) {
  return asArray(raw)
    .map((faq, index) => classifyFaq(faq, fieldMeta, faqFieldPath(index)))
    .filter((row) => row.question && row.answer && !row.fact)
    .map((row) => `FAQ: ${row.question}`);
}

/** tenant_hold_gate result, or null when the RPC is not on this database. */
export function holdGateDecision(profile: any = {}) {
  const gate = profile.holdGate;
  if (!gate || typeof gate !== 'object' || typeof gate.allowed !== 'boolean') return null;
  const reasons = Array.isArray(gate.reasons) ? gate.reasons.map(String) : [];
  if (reasons.includes('provenance_rpc_missing')) return null;
  return gate.allowed === true;
}

export function holdOrdersEnabled(profile: any = {}) {
  const fromRpc = holdGateDecision(profile);
  if (fromRpc !== null) return fromRpc;
  const fieldMeta = profile.fieldMeta || null;
  if (!factProducts(profile.productCatalog, fieldMeta).length) return false;
  return holdRulesAllow(profile.businessPolicies, fieldMeta);
}

export function confirmedSlotEnabled(profile: any = {}) {
  const obj = asObject(profile.businessPolicies);
  const mode = String(obj.booking_mode || obj.bookingMode || '').trim().toLowerCase();
  if (mode !== 'confirmed_slot') return false;
  const meta = obj.booking || obj.booking_meta || policyMeta(obj, 'booking_mode');
  return classifyRecord(
    typeof meta === 'object' && meta ? { ...meta, source: meta.source || obj.source } : meta,
    { packSeed: false }
  ).fact;
}

export function formatUnknownSection(topics: any) {
  const list = [...new Set((topics || []).map((t: any) => String(t || '').trim()).filter(Boolean))];
  const lines = [
    'UNKNOWN (not confirmed by the owner. Do not state these as fact. Say you will confirm with the owner):',
  ];
  if (!list.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const topic of list) lines.push(`- ${topic}`);
  lines.push(
    'For an UNKNOWN topic: admit you do not have it. Say: "Let me confirm with the owner." Do not guess, and do not use a pack seed as the answer.',
    'A fact stated elsewhere in this brief (hours, coverage, services, prices, payment) wins over an UNKNOWN line on the same topic.'
  );
  return lines.join('\n');
}

/**
 * Sections for llm_system_prompt. Seed FAQs are not GOLDEN. Seed policy lines
 * are removed from the fact block and listed under UNKNOWN.
 */
export function buildCompileSections({
  faqs = [],
  policiesText = '',
  productsText = '',
  servicesText = '',
  productCatalog = null,
  businessPolicies = null,
  fieldMeta = null,
  holdGate = null,
  hashMode = undefined,
}: {
  faqs?: unknown[];
  policiesText?: string;
  productsText?: string;
  servicesText?: string;
  productCatalog?: unknown;
  businessPolicies?: unknown;
  fieldMeta?: unknown;
  holdGate?: unknown;
  /** Pass from the server (FACT_HASH_MODE); client code never reads env. */
  hashMode?: boolean;
} = {}) {
  fieldMeta = withHashMode(fieldMeta, hashMode);
  const faqRows = asArray(faqs)
    .map((faq, index) => classifyFaq(faq, fieldMeta, faqFieldPath(index)))
    .filter((row) => row.question && row.answer);
  const factFaqs = faqRows.filter((row) => row.fact);
  const unknown = faqRows.filter((row) => !row.fact).map((row) => `FAQ: ${row.question}`);

  let policyBody = String(policiesText || '').trim();
  if (businessPolicies) {
    const split = factPolicyMap(businessPolicies, fieldMeta);
    const lines: string[] = [];
    for (const [key, label] of Object.entries(POLICY_TOPICS)) {
      if (split.policies[key]) lines.push(`- ${label}: ${split.policies[key]}`);
    }
    policyBody = lines.join('\n');
    for (const topic of split.unknown) {
      if (!unknown.includes(topic)) unknown.push(topic);
    }
  } else if (policyBody) {
    const kept: string[] = [];
    for (const line of policyBody.split('\n')) {
      const match = line.match(/^-\s*([^:]+):\s*(.+)$/);
      if (match && isPackPolicyText(match[2])) {
        const label = match[1].trim();
        if (!unknown.includes(label)) unknown.push(label);
        continue;
      }
      kept.push(line);
    }
    policyBody = kept.join('\n').trim();
  }

  let servicesBody = String(servicesText || '');
  if (servicesBody) {
    const kept: string[] = [];
    for (const line of servicesBody.split('\n')) {
      const seed = PACK_SERVICES.some(([name, , notes]) => {
        const hay = norm(line);
        return hay.includes(norm(name)) && hay.includes(norm(notes));
      });
      if (seed) {
        if (!unknown.includes('Services')) unknown.push('Services');
        continue;
      }
      kept.push(line);
    }
    servicesBody = kept.join('\n').trim();
  }

  let productsBody = String(productsText || '').trim();
  if (productCatalog) {
    const named = asArray(productCatalog).filter((row) => String(row?.name || '').trim());
    const rows = factProducts(productCatalog, fieldMeta);
    if (named.length && !rows.length) {
      productsBody = '';
      if (!unknown.includes('Product catalogue')) unknown.push('Product catalogue');
    } else if (rows.length && rows.length < named.length) {
      productsBody = rows
        .map((row) => {
          const price = String(row.price || row.price_range || row.priceRange || '').trim();
          return price ? `- ${row.name} - ${price}` : `- ${row.name}`;
        })
        .join('\n');
      if (!unknown.includes('Product catalogue')) unknown.push('Product catalogue');
    }
  }

  const faqBlock = factFaqs.length
    ? factFaqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
    : '(none confirmed)';

  return {
    faqBlock,
    policiesText: policyBody || '(none confirmed)',
    productsText: productsBody || '(none confirmed)',
    servicesText: servicesBody,
    unknownBlock: formatUnknownSection(unknown),
    unknownTopics: unknown,
    holdsAvailable: holdOrdersEnabled({
      productCatalog: productCatalog || [],
      businessPolicies: businessPolicies || {},
      fieldMeta,
      holdGate,
    }),
    confirmedSlotsAvailable: confirmedSlotEnabled({
      businessPolicies: businessPolicies || {},
    }),
  };
}

export function speechFactText(profile: any = {}) {
  const fieldMeta = profile.fieldMeta || null;
  const policies = factPolicyMap(profile.businessPolicies, fieldMeta).policies;
  const products = factProducts(profile.productCatalog, fieldMeta).map((row) => ({
    name: row.name,
    price: row.price || row.price_range || row.priceRange || '',
    notes: row.notes || '',
  }));
  const services = factServices(profile.servicesCatalog, fieldMeta).map((row) => ({
    name: row.name,
    price_range: row.price_range || row.priceRange || '',
    notes: row.notes || '',
  }));
  const faqs = factFaqs(profile.faqs, fieldMeta).map((row) => ({
    question: row.question,
    answer: row.answer,
  }));
  return JSON.stringify({
    businessName: profile.businessName || profile.business_name || '',
    hours: profile.hoursSchedule || profile.hours_schedule || profile.businessHours || profile.business_hours || '',
    locations: profile.businessLocations || profile.business_locations || '',
    bulletin: profile.dailyBulletin || profile.daily_bulletin || '',
    team: profile.teamDirectory || profile.team_directory || '',
    social: profile.socialHandles || profile.social_handles || '',
    notes: profile.servicesNotes || profile.servicesOffered || profile.services_offered || '',
    policies,
    products,
    services,
    faqs,
  });
}
