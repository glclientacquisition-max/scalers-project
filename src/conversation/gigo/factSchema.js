// GIGO P1/P2 fact schemas: what onboarding and Settings collect, where it is
// stored today, which tenant_field_meta field_path carries its provenance, and
// how a stored value is validated.
//
// Sources:
//   - 10 domains: tenant_completeness_score in docs/supabase/tenant_field_provenance.sql
//     (identity, catalog, hours, locations, payments, policies, faqs,
//     team_notify, assistant, bulletin).
//   - field_path names: docs/platform/TENANT_FIELD_PROVENANCE.md and
//     dashboard/src/lib/fieldPathRegistry.ts.
//   - P1 = structured schemas for all 10 domains plus Brain tools that read
//     them. P2 = deep BI loop: unmet demand, staleness re-verify, digest.
//     (docs/STATUS.md section 7, PR #619.)
//
// No SQL here. Values stay on tenants columns; this file only describes and
// validates them. Proposed new leaves (catalog lead_time) are listed in
// docs/specs/gigo-p1-p2-facts.md for Platform.

const {
  validateText,
  validateEnum,
  validatePhone,
  validateEmail,
  validateList,
  MISSING,
  GARBAGE,
} = require('./factValidate');
const { parseHoursSchedule } = require('../businessHours');
const { activeBulletinItems } = require('../dailyBulletin');
const { normalizeLocations } = require('../businessLocations');
const { readCoverageAreas } = require('../coverageAreas');

const GIGO_DOMAINS = Object.freeze([
  'identity',
  'catalog',
  'hours',
  'locations',
  'payments',
  'policies',
  'faqs',
  'team_notify',
  'assistant',
  'bulletin',
]);

function policiesOf(profile) {
  const raw = profile?.businessPolicies;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function validateHours({ schedule, text }) {
  const parsed = parseHoursSchedule(schedule);
  if (parsed) return { ok: true, value: { schedule: parsed } };
  const line = validateText(text, { max: 200 });
  if (line.ok) return { ok: true, value: { text: line.value } };
  // A schedule was stored but no day parses: garbage, not a default week.
  if (schedule) return GARBAGE;
  return line;
}

function validateBranches(raw) {
  const rows = normalizeLocations(raw).filter(
    (row) => validateText(row.address).ok || validateText(row.landmark).ok || validateText(row.directions).ok
  );
  if (rows.length) return { ok: true, value: rows };
  return Array.isArray(raw) && raw.length ? GARBAGE : MISSING;
}

function validateCoverage(policies) {
  const has = Object.prototype.hasOwnProperty.call(policies, 'coverage_areas');
  if (!has || policies.coverage_areas == null) return MISSING;
  const list = readCoverageAreas(policies);
  if (list == null) return GARBAGE;
  // An empty saved list is not "we serve nowhere". It is missing.
  if (!list.length) return Array.isArray(policies.coverage_areas) && policies.coverage_areas.length ? GARBAGE : MISSING;
  return { ok: true, value: list };
}

const TONES = { professional: 'professional', warm: 'warm', friendly: 'warm', empathetic: 'warm', localized: 'warm' };

function validateTone(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return MISSING;
  return TONES[t] ? { ok: true, value: TONES[t] } : GARBAGE;
}

function validateAgentName(raw) {
  // tenantProfileFromRow fills 'Receptionist' when agent_name is empty.
  // That fill is not an owner fact.
  if (String(raw || '').trim().toLowerCase() === 'receptionist') return MISSING;
  return validateText(raw, { max: 40 });
}

function validateBulletin(raw, now) {
  const items = activeBulletinItems(raw, now)
    .map((item) => validateText(item.text, { max: 160 }))
    .filter((row) => row.ok)
    .map((row) => row.value);
  return items.length ? { ok: true, value: items } : MISSING;
}

/**
 * Scalar fact definitions.
 * - key:        stable reader key, `<domain>.<name>`
 * - phase:      'P1' (structured fact) ; P2 adds freshness on top of these
 * - fieldPath:  tenant_field_meta field_path that carries provenance
 * - topic:      caller-safe topic label for the UNKNOWN list
 * - speakable:  false for facts the caller must never hear (notify targets)
 * - volatile:   true when a stale value must be treated as unknown (P2)
 * - shelfLife:  DEFAULT_STALE_AFTER_DAYS key used when the meta row has no stale_after_days
 * - read:       profile -> raw stored value
 * - validate:   raw -> { ok, value } | { ok: false, reason }
 */
const FACTS = [
  {
    key: 'identity.business_name',
    shelfLife: 'identity',
    domain: 'identity',
    fieldPath: 'identity.business_name',
    topic: 'Business name',
    read: (p) => p.businessName,
    validate: (raw) => validateText(raw, { max: 120 }),
  },
  {
    key: 'identity.vertical',
    shelfLife: 'identity',
    domain: 'identity',
    fieldPath: 'identity.vertical',
    topic: 'Business type',
    speakable: false,
    read: (p) => p.vertical,
    // 'general' is what parseVertical returns for an empty column.
    validate: (raw) =>
      String(raw || '').trim().toLowerCase() === 'general'
        ? MISSING
        : validateEnum(raw, ['retail', 'home_services', 'hospitality']),
  },
  {
    key: 'identity.primary_phone',
    shelfLife: 'identity',
    domain: 'identity',
    fieldPath: 'identity.primary_phone',
    topic: 'Business line',
    speakable: false,
    read: (p) => p.did,
    validate: validatePhone,
  },
  {
    key: 'hours.weekly',
    shelfLife: 'hours',
    domain: 'hours',
    fieldPath: 'hours.weekly_grid',
    topic: 'Opening hours',
    read: (p) => ({ schedule: p.hoursSchedule, text: p.businessHours }),
    validate: validateHours,
    present: (raw) => Boolean(raw && (raw.schedule || raw.text)),
  },
  {
    key: 'locations.branches',
    shelfLife: 'locations',
    domain: 'locations',
    fieldPath: 'locations.branches',
    topic: 'Location and directions',
    read: (p) => p.businessLocations,
    validate: validateBranches,
  },
  {
    key: 'locations.coverage_areas',
    shelfLife: 'coverage_areas',
    domain: 'locations',
    fieldPath: 'policies.coverage_areas',
    topic: 'Areas we serve',
    read: (p) => policiesOf(p),
    validate: validateCoverage,
    present: (raw) => raw && raw.coverage_areas != null,
  },
  {
    key: 'payments.methods',
    shelfLife: 'payments',
    domain: 'payments',
    fieldPath: 'policies.payment',
    topic: 'Payment',
    policyKey: 'payment',
    read: (p) => policiesOf(p).payment,
    validate: (raw) => validateText(raw),
  },
  {
    key: 'payments.deposit',
    shelfLife: 'deposits',
    domain: 'payments',
    fieldPath: 'policies.deposit',
    topic: 'Deposits',
    policyKey: 'deposit',
    read: (p) => policiesOf(p).deposit,
    validate: (raw) => validateText(raw),
  },
  ...['returns', 'delivery', 'cancellation', 'warranty', 'other'].map((name) => ({
    key: `policies.${name}`,
    shelfLife: 'policies',
    domain: 'policies',
    fieldPath: `policies.${name}`,
    topic: name === 'other' ? 'Other policy' : name.charAt(0).toUpperCase() + name.slice(1),
    policyKey: name,
    read: (p) => policiesOf(p)[name],
    validate: (raw) => validateText(raw),
  })),
  {
    key: 'team_notify.whatsapp',
    shelfLife: 'team_notify',
    domain: 'team_notify',
    fieldPath: 'team.notify.whatsapp',
    topic: 'Owner alerts',
    speakable: false,
    read: (p) => p.whatsappNumber,
    validate: validatePhone,
  },
  {
    key: 'team_notify.email',
    shelfLife: 'team_notify',
    domain: 'team_notify',
    fieldPath: 'team.notify.email',
    topic: 'Owner alerts',
    speakable: false,
    read: (p) => p.alertEmail,
    validate: validateEmail,
  },
  {
    key: 'assistant.agent_name',
    shelfLife: 'assistant',
    domain: 'assistant',
    fieldPath: 'assistant.agent_name',
    topic: 'Assistant name',
    read: (p) => p.agentName,
    validate: validateAgentName,
  },
  {
    key: 'assistant.tone',
    shelfLife: 'assistant',
    domain: 'assistant',
    fieldPath: 'assistant.tone',
    topic: 'Tone',
    speakable: false,
    read: (p) => p.agentTone,
    validate: validateTone,
  },
  {
    key: 'bulletin.active',
    shelfLife: 'bulletin',
    domain: 'bulletin',
    fieldPath: 'bulletin.items',
    topic: "Today's notice",
    read: (p) => p.dailyBulletin,
    validate: (raw, ctx) => validateBulletin(raw, ctx?.now || new Date()),
  },
].map((def) => Object.freeze({ phase: 'P1', speakable: true, volatile: false, ...def }));

/**
 * GIGO P2 default shelf life in days, approved by Alvin 2026-10-09
 * (docs/specs/gigo-p1-p2-facts.md). Used only in FACT_HASH_MODE and only when
 * the tenant_field_meta row has no stale_after_days of its own. null = never
 * stale by age (bulletin items carry ends_at; identity, assistant and notify
 * targets reopen through the value hash on edit). Volatile entries (stock,
 * price, lead time) read as unknown once stale; the rest are still spoken and
 * flagged for re-confirm.
 */
const DEFAULT_STALE_AFTER_DAYS = Object.freeze({
  in_stock: 3,
  price: 30,
  lead_time: 14,
  bulletin: null,
  hours: 90,
  coverage_areas: 180,
  payments: 180,
  deposits: 90,
  policies: 180,
  faqs: 180,
  locations: 365,
  identity: null,
  assistant: null,
  team_notify: null,
});

/** Default shelf life for a shelfLife key, or null (never stale by age). */
function defaultStaleAfterDays(shelfLife) {
  const days = DEFAULT_STALE_AFTER_DAYS[shelfLife];
  return Number.isFinite(days) && days > 0 ? days : null;
}

/**
 * Per-row catalogue leaves. Row provenance rides on the row's name path
 * (catalog.product.<sku|n>.name, catalog.service.<n>.name); a leaf is never a
 * fact when its row is not. volatile leaves turn unknown when stale (P2).
 */
const CATALOG_LEAVES = Object.freeze({
  price: Object.freeze({ topic: 'Price', volatile: true }),
  in_stock: Object.freeze({ topic: 'Stock', volatile: true }),
  lead_time: Object.freeze({ topic: 'Delivery or lead time', volatile: true }),
});

/** Domains whose facts the faqs/catalog readers own (no scalar FACTS entry). */
const LIST_DOMAINS = Object.freeze(['catalog', 'faqs']);

const FACT_BY_KEY = Object.freeze(Object.fromEntries(FACTS.map((def) => [def.key, def])));

function factDefinition(key) {
  return FACT_BY_KEY[String(key || '').trim()] || null;
}

function factsForDomain(domain) {
  return FACTS.filter((def) => def.domain === domain);
}

module.exports = {
  DEFAULT_STALE_AFTER_DAYS,
  defaultStaleAfterDays,
  GIGO_DOMAINS,
  FACTS,
  CATALOG_LEAVES,
  LIST_DOMAINS,
  factDefinition,
  factsForDomain,
  policiesOf,
};
