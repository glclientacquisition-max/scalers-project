// GIGO P1 readers: owner-confirmed business facts for the live call and the
// prompt. GIGO P2 freshness rides on the same readings.
//
// Contract:
//   - A reading is { status: 'known', value } only when the stored value
//     validates AND provenance says owner (or an explicit confirm).
//   - Missing, garbage, seed, import, inferred, call_suggested, and stale
//     volatile values come back { status: 'unknown', value: null, reason }.
//   - Nothing here fills a default, rounds a price, guesses stock, or makes up
//     an ETA. The unknown line says the assistant will confirm with the owner,
//     or (message mode) take a message.
//   - Caller name is not read here. It stays a code-held phone-file fact.

const {
  classifyRecord,
  lookupFieldMeta,
  productFieldPath,
  serviceFieldPath,
  policyMeta,
  isPackPolicyText,
  isPackService,
  factFaqs,
  unknownFaqTopics,
  formatUnknownSection,
  withHashMode,
  resolveHashMode,
  faqFieldPath,
} = require('../provenance');
const { factValueForPath, tenantRowFromProfile, catalogRowFactValue, siteVisitFactValue } = require('../factHash');
const { isMessageOnlyMode } = require('../messageOnly');
const { formatScheduleSummary } = require('../businessHours');
const { coveredByAreas, formatCoverageList } = require('../coverageAreas');
const { normalizePlaceKey } = require('../kenyaPlaces');
const {
  validatePrice,
  validateStock,
  validateEta,
  validateText,
  asText,
} = require('./factValidate');
const {
  FACTS,
  CATALOG_LEAVES,
  GIGO_DOMAINS,
  defaultStaleAfterDays,
  factDefinition,
  policiesOf,
} = require('./factSchema');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Profile with an explicit confirm-v2 hash mode pinned on its fieldMeta.
 * Without an explicit { hashMode }, provenance.js reads FACT_HASH_MODE.
 */
function scoped(profileIn, hashMode) {
  const profile = profileIn && typeof profileIn === 'object' ? profileIn : {};
  if (typeof hashMode !== 'boolean') return profile;
  return { ...profile, fieldMeta: withHashMode(profile.fieldMeta || null, hashMode) };
}

/**
 * P2 freshness. The meta row's stale_after_days wins. defaultDays (the
 * approved DEFAULT_STALE_AFTER_DAYS) is passed only in FACT_HASH_MODE, so with
 * the flag off only an explicit stale_after_days makes a fact stale.
 */
function freshness(meta, now = new Date(), { defaultDays = null } = {}) {
  if (!meta) return { stale: false, verifiedAt: null };
  const verifiedAt = meta.last_verified_at || meta.confirmed_at || null;
  const own = Number(meta.stale_after_days);
  const days = Number.isFinite(own) && own > 0 ? own : Number(defaultDays);
  if (!verifiedAt || !Number.isFinite(days) || days <= 0) return { stale: false, verifiedAt };
  const at = new Date(verifiedAt);
  if (Number.isNaN(at.getTime())) return { stale: false, verifiedAt };
  return { stale: now.getTime() - at.getTime() > days * DAY_MS, verifiedAt };
}

/** Hash mode for a scoped profile: pinned fieldMeta.hashMode, else FACT_HASH_MODE. */
function hashModeOf(profile) {
  return resolveHashMode(undefined, profile.fieldMeta || null);
}

/** Freshness with the approved default shelf life, applied only in hash mode. */
function freshnessFor(profile, fieldPath, shelfLife, now) {
  const meta = lookupFieldMeta(profile.fieldMeta || null, fieldPath);
  if (!hashModeOf(profile)) return freshness(meta, now);
  return freshness(meta, now, { defaultDays: defaultStaleAfterDays(shelfLife) });
}

function unknownReading(base, reason, source = '') {
  return { ...base, status: 'unknown', value: null, reason, source, stale: reason === 'stale' };
}

function provenanceFor(def, raw, profile) {
  const fieldMeta = profile.fieldMeta || null;
  // Confirm v2: the value the owner's value_hash must match.
  const value = factValueForPath(def.fieldPath, tenantRowFromProfile(profile));
  if (def.policyKey) {
    const text = asText(raw);
    const packSeed = isPackPolicyText(text);
    const meta = policyMeta(policiesOf(profile), def.policyKey);
    const base = meta && Object.keys(meta).length ? meta : { source: packSeed ? 'seed' : '' };
    return classifyRecord(base, { packSeed, fieldMeta, fieldPath: def.fieldPath, value });
  }
  return classifyRecord({}, { packSeed: false, fieldMeta, fieldPath: def.fieldPath, value });
}

/**
 * Read one scalar fact.
 * @param {object} profile  voice profile (tenantProfileFromRow shape)
 * @param {string} key      e.g. 'hours.weekly', 'payments.methods'
 * @param {{ now?: Date }} [opts]
 */
function readFact(profileIn = {}, key, { now = new Date(), hashMode } = {}) {
  const profile = scoped(profileIn, hashMode);
  const def = factDefinition(key);
  if (!def) {
    return {
      key: String(key || ''),
      domain: '',
      phase: '',
      topic: '',
      fieldPath: '',
      speakable: false,
      status: 'unknown',
      value: null,
      reason: 'no_such_fact',
      source: '',
      stale: false,
    };
  }
  const base = {
    key: def.key,
    domain: def.domain,
    phase: def.phase,
    topic: def.topic,
    fieldPath: def.fieldPath,
    speakable: def.speakable,
  };
  const raw = def.read(profile);
  const checked = def.validate(raw, { now, profile });
  if (!checked.ok) return unknownReading(base, checked.reason);

  const prov = provenanceFor(def, raw, profile);
  if (!prov.fact) return unknownReading(base, 'unconfirmed', prov.source);

  const { stale, verifiedAt } = freshnessFor(profile, def.fieldPath, def.shelfLife, now);
  // Hash mode only: a stale fact is flagged for the owner to re-confirm.
  const flag = hashModeOf(profile) ? { reconfirm: stale } : {};
  if (stale && def.volatile) return { ...unknownReading(base, 'stale', prov.source), ...flag };
  return {
    ...base,
    status: 'known',
    value: checked.value,
    reason: null,
    source: prov.source,
    stale,
    verifiedAt,
    ...flag,
  };
}

/** Every scalar fact of one GIGO domain. */
function readDomain(profile = {}, domain, opts = {}) {
  return FACTS.filter((def) => def.domain === domain).map((def) => readFact(profile, def.key, opts));
}

function asArray(raw) {
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

function leafReading(name, checked, rowStale, gateOk = true) {
  const leaf = CATALOG_LEAVES[name];
  if (!checked.ok) return { status: 'unknown', value: null, reason: checked.reason, topic: leaf.topic };
  if (!gateOk) return { status: 'unknown', value: null, reason: 'unconfirmed', topic: leaf.topic };
  if (rowStale && leaf.volatile) return { status: 'unknown', value: null, reason: 'stale', topic: leaf.topic };
  return { status: 'known', value: checked.value, reason: null, topic: leaf.topic };
}

/** Service site visit: true / false as stored (same rule as factHash), else missing. */
function validateSiteVisit(row) {
  const value = siteVisitFactValue(row);
  return value === null ? { ok: false, reason: 'missing' } : { ok: true, value };
}

function catalogRows(profile, kind, now) {
  const fieldMeta = profile.fieldMeta || null;
  const hashOn = hashModeOf(profile);
  const raw = asArray(kind === 'product' ? profile.productCatalog : profile.servicesCatalog);
  const items = [];
  let unconfirmed = 0;
  let garbage = 0;
  raw.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const name = validateText(row.name, { max: 160 });
    if (!name.ok) {
      if (name.reason === 'garbage') garbage += 1;
      return;
    }
    const fieldPath = kind === 'product' ? productFieldPath(row, index) : serviceFieldPath(index, row);
    const prov = classifyRecord(row, {
      packSeed: kind === 'service' ? isPackService(row) : false,
      fieldMeta,
      fieldPath,
      value: catalogRowFactValue(row),
    });
    if (!prov.fact) {
      unconfirmed += 1;
      return;
    }
    // Row meta rides on the name path. Flag off: one row-level stale for every
    // leaf (explicit stale_after_days only). Hash mode: an explicit row value
    // still covers every leaf; otherwise each leaf uses its own default.
    const rowMeta = lookupFieldMeta(fieldMeta, fieldPath);
    const rowFresh = freshness(rowMeta, now);
    // Hash mode only: an owner leaf row (catalog.<kind>.<key>.price /
    // .site_visit) is an extra gate on that leaf, and its own freshness
    // replaces the row's for that leaf. No leaf row: the leaf follows the row.
    const leafGate = (leaf) => {
      if (!hashOn) return { ok: true, meta: null };
      const leafPath = fieldPath.replace(/\.name$/, `.${leaf}`);
      const meta = lookupFieldMeta(fieldMeta, leafPath);
      if (!meta) return { ok: true, meta: null };
      const stored = kind === 'product' ? { product_catalog: raw } : { services_catalog: raw };
      const value = factValueForPath(leafPath, stored);
      return { ok: classifyRecord({}, { fieldMeta, fieldPath: leafPath, value, hashMode: true }).fact, meta };
    };
    const gates = { price: leafGate('price'), site_visit: kind === 'service' ? leafGate('site_visit') : null };
    const leafStale = (leaf) => {
      if (!hashOn) return rowFresh.stale;
      if (gates[leaf]?.meta) return freshness(gates[leaf].meta, now, { defaultDays: defaultStaleAfterDays(leaf) }).stale;
      return freshnessFor(profile, fieldPath, leaf, now).stale;
    };
    const staleBy = { price: leafStale('price'), in_stock: leafStale('in_stock'), lead_time: leafStale('lead_time') };
    const stale = hashOn ? Object.values(staleBy).some(Boolean) : rowFresh.stale;
    const priceRaw = kind === 'product' ? row.price ?? row.price_range : row.price_range ?? row.priceRange ?? row.price;
    const modeRaw = row.price_mode ?? row.pricing_mode ?? row.priceMode ?? row.pricingMode;
    const aliases = (Array.isArray(row.aliases) ? row.aliases : [])
      .map((a) => validateText(a, { max: 80 }))
      .filter((a) => a.ok)
      .map((a) => a.value);
    const outOfScope = validateText(row.out_of_scope ?? row.outOfScope);
    items.push({
      kind,
      name: name.value,
      aliases,
      fieldPath,
      source: prov.source,
      stale,
      price: leafReading('price', validatePrice(priceRaw, modeRaw), staleBy.price, gates.price.ok),
      in_stock: leafReading('in_stock', validateStock(row.in_stock ?? row.inStock), staleBy.in_stock),
      lead_time: leafReading('lead_time', validateEta(row.lead_time ?? row.leadTime ?? row.eta), staleBy.lead_time),
      out_of_scope: outOfScope.ok ? outOfScope.value : null,
      ...(kind === 'service'
        ? { site_visit: leafReading('site_visit', validateSiteVisit(row), false, gates.site_visit.ok) }
        : {}),
      ...(hashOn ? { reconfirm: stale } : {}),
    });
  });
  return { items, unconfirmed, garbage };
}

/**
 * Owner-confirmed catalogue. Unconfirmed and garbage rows are counted, never
 * returned as items.
 */
function readCatalog(profileIn = {}, { now = new Date(), hashMode } = {}) {
  const profile = scoped(profileIn, hashMode);
  const services = catalogRows(profile, 'service', now);
  const products = catalogRows(profile, 'product', now);
  const items = [...services.items, ...products.items];
  return {
    domain: 'catalog',
    status: items.length ? 'known' : 'unknown',
    reason: items.length ? null : services.unconfirmed + products.unconfirmed ? 'unconfirmed' : 'missing',
    services: services.items,
    products: products.items,
    unconfirmedCount: services.unconfirmed + products.unconfirmed,
    garbageCount: services.garbage + products.garbage,
  };
}

function normKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(query, item) {
  const q = normKey(query);
  if (!q) return 0;
  let best = 0;
  for (const label of [item.name, ...item.aliases]) {
    const n = normKey(label);
    if (!n) continue;
    if (n === q) return 3;
    if (n.includes(q) || q.includes(n)) best = Math.max(best, 2);
    const qWords = q.split(' ').filter((w) => w.length >= 3);
    const nWords = new Set(n.split(' '));
    if (qWords.length && qWords.every((w) => nWords.has(w))) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Find a confirmed catalogue row by spoken name.
 * - found:      a confirmed row matched. Leaves (price, stock, lead time) may
 *               still be unknown individually.
 * - not_listed: a confirmed catalogue exists and nothing matched.
 * - unknown:    there is no confirmed catalogue, so "we don't sell that"
 *               cannot be said either.
 */
function lookupCatalogItem(profile = {}, query, opts = {}) {
  const catalog = readCatalog(profile, opts);
  if (catalog.status !== 'known') {
    return { status: 'unknown', reason: catalog.reason, item: null };
  }
  let best = null;
  let bestScore = 0;
  for (const item of [...catalog.services, ...catalog.products]) {
    const score = matchScore(query, item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (!best) return { status: 'not_listed', reason: null, item: null };
  return { status: 'found', reason: null, item: best };
}

/** Owner-confirmed FAQs and the unconfirmed FAQ topics. */
function readFaqs(profileIn = {}, { hashMode, now = new Date() } = {}) {
  const profile = scoped(profileIn, hashMode);
  const fieldMeta = profile.fieldMeta || null;
  const known = factFaqs(profile.faqs, fieldMeta)
    .filter((row) => validateText(row.question).ok && validateText(row.answer).ok)
    .map((row) => ({ question: row.question, answer: row.answer }));
  const out = {
    domain: 'faqs',
    status: known.length ? 'known' : 'unknown',
    reason: known.length ? null : 'missing',
    faqs: known,
    unknownTopics: unknownFaqTopics(profile.faqs, fieldMeta),
  };
  if (!hashModeOf(profile)) return out;
  // Hash mode: FAQs are not volatile, so a stale one is still spoken and its
  // { question, fieldPath } is listed for the owner to re-confirm.
  const knownQs = new Set(known.map((f) => f.question));
  out.reconfirm = asArray(profile.faqs)
    .map((faq, index) => ({ faq, path: faqFieldPath(index) }))
    .filter(({ faq, path }) => knownQs.has(faq?.question) && freshnessFor(profile, path, 'faqs', now).stale)
    .map(({ faq, path }) => ({ question: faq.question, fieldPath: path }));
  return out;
}

/**
 * Coverage check for a caller's place against the owner-confirmed list.
 * covered | not_covered | unknown (no confirmed list: never say outside).
 */
function checkCoverage(profile = {}, place, opts = {}) {
  const reading = readFact(profile, 'locations.coverage_areas', opts);
  if (reading.status !== 'known') return { status: 'unknown', reason: reading.reason };
  if (!normalizePlaceKey(place)) return { status: 'unknown', reason: 'no_place' };
  return {
    status: coveredByAreas(place, reading.value) ? 'covered' : 'not_covered',
    reason: null,
    areas: formatCoverageList(reading.value),
  };
}

/** Every reading, grouped by the 10 GIGO domains. */
function readAllFacts(profile = {}, opts = {}) {
  const out = {};
  for (const domain of GIGO_DOMAINS) {
    if (domain === 'catalog') out.catalog = readCatalog(profile, opts);
    else if (domain === 'faqs') out.faqs = readFaqs(profile, opts);
    else out[domain] = readDomain(profile, domain, opts);
  }
  return out;
}

/**
 * Hash mode only: the stale facts the owner should re-confirm (P2 re-verify
 * queue), as { fieldPath, topic, volatile }. [] when the flag is off.
 */
function factsToReconfirm(profileIn = {}, opts = {}) {
  const profile = scoped(profileIn, opts.hashMode);
  if (!hashModeOf(profile)) return [];
  const all = readAllFacts(profile, { ...opts, hashMode: undefined });
  const out = [];
  for (const domain of GIGO_DOMAINS) {
    if (domain === 'catalog' || domain === 'faqs') continue;
    for (const r of all[domain]) {
      if (r.reconfirm) out.push({ fieldPath: r.fieldPath, topic: r.topic, volatile: Boolean(factDefinition(r.key)?.volatile) });
    }
  }
  for (const item of [...all.catalog.services, ...all.catalog.products]) {
    if (item.reconfirm) out.push({ fieldPath: item.fieldPath, topic: item.name, volatile: true });
  }
  for (const f of all.faqs.reconfirm || []) out.push({ fieldPath: f.fieldPath, topic: `FAQ: ${f.question}`, volatile: false });
  return out;
}

const SW_LANGS = new Set(['sw', 'sheng']);

/**
 * The line spoken when a fact is unknown. Serve mode offers to confirm with
 * the owner. Message mode offers to take a message. It never promises a
 * callback (that is spoken only after a callback row is saved) and never
 * guesses the fact.
 * @param {{ topic?: string, language?: string, afterHoursMode?: string }} [opts]
 */
function unknownFactLine({ topic = '', language = 'en', afterHoursMode = 'serve' } = {}) {
  const sw = SW_LANGS.has(String(language || '').toLowerCase());
  const message = isMessageOnlyMode(afterHoursMode);
  if (sw) {
    return message
      ? 'Sina habari hiyo kwa uhakika. Naweza kuchukua ujumbe kwa mwenye biashara.'
      : 'Sina habari hiyo kwa uhakika. Nitathibitisha na mwenye biashara.';
  }
  const what = String(topic || '').trim().toLowerCase();
  const lead = what ? `I don't have the ${what} confirmed.` : "I don't have that confirmed.";
  return message ? `${lead} I can take a message for the owner.` : `${lead} Let me confirm with the owner.`;
}

function hoursLine(value) {
  if (value.schedule) return formatScheduleSummary(value.schedule).replace(/\n/g, '; ');
  return value.text;
}

/**
 * Prompt block: owner-confirmed facts the call may state, then UNKNOWN topics.
 * Notify targets and other non-speakable facts never appear.
 */
function formatGigoFactsForPrompt(profile = {}, opts = {}) {
  const all = readAllFacts(profile, opts);
  const lines = ['CONFIRMED BUSINESS FACTS (owner-confirmed; state only these as fact):'];
  const unknown = [];
  for (const domain of GIGO_DOMAINS) {
    if (domain === 'catalog' || domain === 'faqs') continue;
    for (const r of all[domain]) {
      if (!r.speakable) continue;
      if (r.status !== 'known') {
        unknown.push(r.topic);
        continue;
      }
      let text = '';
      if (r.key === 'hours.weekly') text = hoursLine(r.value);
      else if (r.key === 'locations.branches') {
        text = r.value
          .map((b) => [b.label, b.address, b.landmark && `near ${b.landmark}`].filter(Boolean).join(', '))
          .join(' | ');
      } else if (r.key === 'locations.coverage_areas') text = formatCoverageList(r.value);
      else if (Array.isArray(r.value)) text = r.value.join(' | ');
      else text = String(r.value);
      if (text) lines.push(`- ${r.topic}: ${text}`);
    }
  }
  const catalog = all.catalog;
  for (const item of [...catalog.services, ...catalog.products]) {
    const bits = [item.name];
    bits.push(item.price.status === 'known' ? `price ${item.price.value.text || 'on quote'}` : 'price UNKNOWN');
    if (item.kind === 'product') {
      bits.push(item.in_stock.status === 'known' ? `in stock ${item.in_stock.value}` : 'stock UNKNOWN');
    }
    bits.push(item.lead_time.status === 'known' ? `lead time ${item.lead_time.value}` : 'lead time UNKNOWN');
    lines.push(`- ${item.kind === 'product' ? 'Product' : 'Service'}: ${bits.join(', ')}`);
  }
  if (catalog.status !== 'known' || catalog.unconfirmedCount) unknown.push('Catalogue items not confirmed');
  for (const faq of all.faqs.faqs) lines.push(`- Q: ${faq.question} A: ${faq.answer}`);
  unknown.push(...all.faqs.unknownTopics);
  if (lines.length === 1) lines.push('- (none confirmed)');
  lines.push(
    'A price, stock, lead time, or area marked UNKNOWN is not known. Do not guess it, round it, or borrow it from another item.'
  );
  return `${lines.join('\n')}\n\n${formatUnknownSection(unknown)}`;
}

module.exports = {
  freshness,
  readFact,
  readDomain,
  readCatalog,
  readFaqs,
  lookupCatalogItem,
  checkCoverage,
  readAllFacts,
  factsToReconfirm,
  unknownFactLine,
  formatGigoFactsForPrompt,
};
