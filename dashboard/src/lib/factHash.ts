/* eslint-disable @typescript-eslint/no-explicit-any */
// TS twin of src/conversation/factHash.js (GIGO confirm v2 value hash).
// Pure and sync: no Node crypto, so it runs in the client graph too.
// Keep lockstep with the JS module. Both run tests/fixtures/factHashVectors.json.
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

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** sha256 hex of a string's UTF-8 bytes. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const total = (((bytes.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(total - 4, bitLen >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** "600.00" -> "600", "-0.50" -> "-0.5", "-0" -> "0". Input must match DECIMAL_RE. */
function trimDecimal(text: string): string {
  let s = text;
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Plain decimal text for a finite number, never exponent notation. */
export function numberToDecimal(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  if (Object.is(n, -0) || n === 0) return '0';
  const raw = String(n);
  const m = raw.match(/^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i);
  if (!m) return trimDecimal(raw);
  const sign = m[1];
  const lead = m[2];
  const frac = m[3] || '';
  const expRaw = m[4];
  const exp = Number(expRaw);
  const digits = lead + frac;
  let out: string;
  if (exp >= 0) {
    const point = 1 + exp;
    out = digits.length <= point ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  } else {
    out = `0.${'0'.repeat(-exp - 1)}${digits}`;
  }
  return trimDecimal(sign + out);
}

function canonicalText(value: any): string {
  const t = String(value).normalize('NFC').trim().replace(/\s+/g, ' ');
  return DECIMAL_RE.test(t) ? trimDecimal(t) : t;
}

function canon(value: any, inArray: boolean): string | undefined {
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
      const entries = new Map<string, string>();
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
export function canonicalFactJson(value: any): string {
  const out = canon(value, false);
  return out === undefined ? 'null' : out;
}

/** sha256 hex of the canonical form. Sync and pure, safe in the browser. */
export function hashFactValue(value: any): string {
  return sha256Hex(canonicalFactJson(value));
}

// ---------------------------------------------------------------------------
// Which value a field_path hashes. Desk hashes the same value from the stored
// tenants row when the owner confirms.
// ---------------------------------------------------------------------------

/** Envelope keys on a catalogue / FAQ row. They are not the fact. */
export const ROW_META_KEYS = new Set<string>([
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

function isEmptyLeaf(v: any): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Catalogue row minus envelope keys and empty leaves ("" / null / []). */
export function catalogRowFactValue(row: any): Record<string, any> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const out: Record<string, any> = {};
  for (const [key, v] of Object.entries(row)) {
    if (ROW_META_KEYS.has(key) || isEmptyLeaf(v)) continue;
    out[key] = v;
  }
  return out;
}

export function faqFactValue(faq: any): { question: string; answer: string } {
  return {
    question: String(faq?.question ?? ''),
    answer: String(faq?.answer ?? ''),
  };
}

export function holdsFactValue(policies: any): any {
  const holds = policies?.holds;
  if (holds && typeof holds === 'object' && !Array.isArray(holds)) {
    return holds.allowed ?? holds.enabled ?? null;
  }
  return policies?.holds_allowed ?? null;
}

function asObj(raw: any): any {
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

function asList(raw: any): any[] {
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

const SCALAR_COLUMNS: Record<string, string> = {
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
export function stableRowId(row: any): string | null {
  const id = String(row?.id ?? '').trim();
  if (!id || /^\d+$/.test(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

function findCatalogRow(list: any[], key: string, kind: string): any {
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
export function factValueForPath(fieldPath: string, tenant: any = {}): any {
  const path = String(fieldPath || '').trim();
  const t: any = tenant && typeof tenant === 'object' ? tenant : {};
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
export function tenantRowFromProfile(profile: any = {}): Record<string, any> {
  const p: any = profile && typeof profile === 'object' ? profile : {};
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
