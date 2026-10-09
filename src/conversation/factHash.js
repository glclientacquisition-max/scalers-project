// Fact value hash for owner confirmation (GIGO confirm v2).
//
// tenant_field_meta.value_hash holds sha256(canonical(value)) of the value the
// owner confirmed. A fact counts as confirmed only while the stored value still
// hashes to it. Any edit reopens the fact.
//
// Canonical form (JSON text, then sha256 hex of its UTF-8 bytes):
//   string   NFC, trim, collapse inner whitespace to one space, case kept.
//            A plain decimal string ("600", "600.00", "-1.50") becomes the
//            canonical decimal ("600", "-1.5"). Leading zeros ("0712...")
//            and grouped digits ("1,500") stay text.
//   number   canonical decimal string (600 and 600.0 -> "600"; no exponent).
//            NaN / Infinity -> null.
//   boolean  true / false
//   null     null (undefined at top level or in an array -> null)
//   array    order kept
//   object   keys NFC, sorted by UTF-16 code units; undefined values dropped
//
// Twin: dashboard/src/lib/factHash.ts. Both run tests/fixtures/factHashVectors.json.

const crypto = require('node:crypto');

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** "600.00" -> "600", "-0.50" -> "-0.5", "-0" -> "0". Input must match DECIMAL_RE. */
function trimDecimal(text) {
  let s = text;
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Plain decimal text for a finite number, never exponent notation. */
function numberToDecimal(n) {
  if (!Number.isFinite(n)) return null;
  if (Object.is(n, -0) || n === 0) return '0';
  const raw = String(n);
  const m = raw.match(/^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i);
  if (!m) return trimDecimal(raw);
  const [, sign, lead, frac = '', expRaw] = m;
  const exp = Number(expRaw);
  const digits = lead + frac;
  let out;
  if (exp >= 0) {
    const point = 1 + exp;
    out = digits.length <= point ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  } else {
    out = `0.${'0'.repeat(-exp - 1)}${digits}`;
  }
  return trimDecimal(sign + out);
}

function canonicalText(value) {
  const t = String(value).normalize('NFC').trim().replace(/\s+/g, ' ');
  return DECIMAL_RE.test(t) ? trimDecimal(t) : t;
}

function canon(value, inArray) {
  if (value === undefined) return inArray ? 'null' : undefined;
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(canonicalText(value));
    case 'number': {
      const d = numberToDecimal(value);
      return d == null ? 'null' : JSON.stringify(d);
    }
    case 'bigint':
      return JSON.stringify(trimDecimal(value.toString()));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (typeof value.toJSON === 'function') return canon(value.toJSON(), inArray);
      if (Array.isArray(value)) return `[${value.map((item) => canon(item, true)).join(',')}]`;
      const entries = new Map();
      for (const key of Object.keys(value)) {
        const v = canon(value[key], false);
        if (v === undefined) continue;
        entries.set(key.normalize('NFC'), v);
      }
      const keys = [...entries.keys()].sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${entries.get(k)}`).join(',')}}`;
    }
    default:
      return inArray ? 'null' : undefined;
  }
}

/** Canonical JSON text of a fact value. */
function canonicalFactJson(value) {
  const out = canon(value, false);
  return out === undefined ? 'null' : out;
}

/** sha256 hex of the canonical form. */
function hashFactValue(value) {
  return crypto.createHash('sha256').update(canonicalFactJson(value), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Which value a field_path hashes. Desk hashes the same value from the stored
// tenants row when the owner confirms.
// ---------------------------------------------------------------------------

/** Envelope keys on a catalogue / FAQ row. They are not the fact. */
const ROW_META_KEYS = new Set([
  'source',
  'status',
  'confirmed',
  'confirmed_at',
  'confirmed_by',
  'confirmedAt',
  'confirmedBy',
  'envelope',
  'field_meta',
  'meta',
  'provenance',
  'value_hash',
]);

function isEmptyLeaf(v) {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Catalogue row minus envelope keys and empty leaves ("" / null / []). */
function catalogRowFactValue(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const out = {};
  for (const [key, v] of Object.entries(row)) {
    if (ROW_META_KEYS.has(key) || isEmptyLeaf(v)) continue;
    out[key] = v;
  }
  return out;
}

function faqFactValue(faq) {
  return {
    question: String(faq?.question ?? ''),
    answer: String(faq?.answer ?? ''),
  };
}

function holdsFactValue(policies) {
  const holds = policies?.holds;
  if (holds && typeof holds === 'object' && !Array.isArray(holds)) {
    return holds.allowed ?? holds.enabled ?? null;
  }
  return policies?.holds_allowed ?? null;
}

function asObj(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function asList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

const SCALAR_COLUMNS = {
  'identity.business_name': 'business_name',
  'identity.vertical': 'vertical',
  'identity.primary_phone': 'sautikit_virtual_number',
  'identity.spoken_name': 'spoken_name',
  'identity.language': 'voice_languages',
  'identity.social_handles': 'social_handles',
  'hours.weekly_grid': 'hours_schedule',
  'locations.branches': 'business_locations',
  'team.notify.whatsapp': 'whatsapp_notification_number',
  'team.notify.email': 'alert_email',
  'team.notify.channels': 'notify_channels',
  'assistant.agent_name': 'agent_name',
  'assistant.tone': 'agent_tone',
  'assistant.language': 'agent_tone',
  'assistant.tools': 'agent_tools',
  'bulletin.items': 'daily_bulletin',
};

/** Stable catalogue key: a non-numeric id ("svc_8f2", uuid), else null. */
function stableRowId(row) {
  const id = String(row?.id ?? '').trim();
  if (!id || /^\d+$/.test(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

function findCatalogRow(list, key, kind) {
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (kind === 'service') {
      const id = stableRowId(row);
      if (id ? id === key : String(i + 1) === key) return row;
    } else {
      const sku = String(row?.sku || '').trim();
      if (sku ? sku === key : String(i + 1) === key) return row;
    }
  }
  return undefined;
}

/**
 * The value a field_path confirms, read from a tenants row (snake_case).
 * Returns undefined for an unknown path; a missing value is null.
 * @param {string} fieldPath
 * @param {object} tenant  tenants row
 */
function factValueForPath(fieldPath, tenant = {}) {
  const path = String(fieldPath || '').trim();
  const t = tenant && typeof tenant === 'object' ? tenant : {};
  if (SCALAR_COLUMNS[path]) return t[SCALAR_COLUMNS[path]] ?? null;
  const policies = asObj(t.business_policies);
  if (path === 'payments.methods') return policies.payment ?? null;
  if (path === 'policies.holds' || path === 'policies.holds.allowed') return holdsFactValue(policies);
  let m = path.match(/^policies\.([A-Za-z0-9_]+)$/);
  if (m) return policies[m[1]] ?? null;
  m = path.match(/^faqs\.(\d+)$/);
  if (m) {
    const faq = asList(t.faqs)[Number(m[1]) - 1];
    return faq ? faqFactValue(faq) : null;
  }
  m = path.match(/^catalog\.(service|product)\.(.+)\.name$/);
  if (m) {
    const list = asList(m[1] === 'service' ? t.services_catalog : t.product_catalog);
    const row = findCatalogRow(list, m[2], m[1]);
    return row ? catalogRowFactValue(row) : null;
  }
  return undefined;
}

/** Voice profile (tenantProfileFromRow) back to the tenants columns the hash reads. */
function tenantRowFromProfile(profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  return {
    business_name: p.businessName ?? null,
    vertical: p.vertical ?? null,
    sautikit_virtual_number: p.did ?? null,
    spoken_name: p.spokenName ?? null,
    social_handles: p.socialHandles ?? null,
    hours_schedule: p.hoursSchedule ?? null,
    business_locations: p.businessLocations ?? null,
    business_policies: p.businessPolicies ?? null,
    whatsapp_notification_number: p.whatsappNumber ?? null,
    alert_email: p.alertEmail ?? null,
    notify_channels: p.notifyChannels ?? null,
    agent_name: p.agentName ?? null,
    agent_tone: p.agentTone ?? null,
    agent_tools: p.agentTools ?? null,
    daily_bulletin: p.dailyBulletin ?? null,
    faqs: p.faqs ?? null,
    services_catalog: p.servicesCatalog ?? null,
    product_catalog: p.productCatalog ?? null,
  };
}

module.exports = {
  canonicalFactJson,
  hashFactValue,
  numberToDecimal,
  factValueForPath,
  catalogRowFactValue,
  faqFactValue,
  holdsFactValue,
  stableRowId,
  tenantRowFromProfile,
  ROW_META_KEYS,
};
