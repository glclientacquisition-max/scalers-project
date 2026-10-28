'use strict';
// v2 Knowledge Base: one item model for products and services (Alvin, 28 Oct: Q1 yes).
// Pure mapping both ways between today's jsonb catalogues and kb_items rows:
//   fromLegacy(row)  services_catalog + product_catalog  -> kb_items (backfill + compat writer)
//   toLegacy(items)  kb_items                            -> services_catalog / product_catalog shapes
// The second direction lets every existing reader (both brains, Desk, receipts) read the KB without a rewrite.

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'item';

const UNIT_WORDS = [
  [/seedling|plant|mche|miche/i, 'seedling'], [/\bkg\b|kilo/i, 'kg'], [/tray|trei/i, 'tray'], [/\bseat\b|kiti/i, 'seat'],
  [/hour|\bhr\b|hourly/i, 'hour'], [/sq\.?\s*m|m²|m2|square\s*met/i, 'sqm'], [/sq\.?\s*ft|square\s*f/i, 'sqft'], [/\broom\b/i, 'room'],
  [/window/i, 'window'], [/visit/i, 'visit'], [/\bjob\b/i, 'job'], [/piece|\bunit\b|each|\bpc\b/i, 'piece'], [/litre|liter|\bl\b/i, 'litre'],
  [/\bbag\b/i, 'bag'], [/\bpack\b|packet/i, 'pack'], [/bunch/i, 'bunch'],
];
function normUnit(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const [re, u] of UNIT_WORDS) if (re.test(s)) return u;
  return s.replace(/^per\s+/i, '').slice(0, 40).toLowerCase() || null;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : null;
}
function stock(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(no|false|0|out|none|sold)/.test(s)) return false;
  if (/^(yes|true|1|in|available)/.test(s)) return true;
  return null;
}
/** Price of one legacy row -> { price_mode, price_amount, price_min, price_max }. Keeps decimals ("2.20" stays 2.2). */
function legacyPrice(row = {}) {
  const p = row.pricing && typeof row.pricing === 'object' ? row.pricing : {};
  const text = String(row.price_range || row.price || '').trim();
  const mode0 = String(p.mode || row.pricing_mode || row.price_mode || '').toLowerCase();
  if (/quote|on\s*request|custom/i.test(mode0) || /custom\s+quote|on\s+request|\bquote\b/i.test(text)) return { price_mode: 'quote', price_amount: null, price_min: null, price_max: null };
  if (/free/.test(mode0) || /^free$/i.test(text)) return { price_mode: 'free', price_amount: 0, price_min: null, price_max: null };
  const parsed = num(p.parsed_from);
  const exactFixed = parsed != null && /^\s*\d[\d,]*(\.\d+)?\s*$/.test(String(p.parsed_from)) ? parsed : null;
  const lo = num(p.min_ksh) ?? null; const hi = num(p.max_ksh ?? row.price_max) ?? null;
  if ((mode0 === 'range' || (lo != null && hi != null)) && hi != null) {
    const min = lo ?? num(p.amount_ksh) ?? num(row.price);
    return { price_mode: 'range', price_amount: null, price_min: min, price_max: hi };
  }
  const amt = exactFixed ?? num(p.amount_ksh) ?? num(row.price) ?? (text ? num(text.split(/[-–]|to/)[0]) : null);
  if (amt == null) return { price_mode: 'none', price_amount: null, price_min: null, price_max: null };
  if (mode0 === 'from' || /^from\b|kuanzia/i.test(text)) return { price_mode: 'from', price_amount: amt, price_min: null, price_max: null };
  return { price_mode: 'fixed', price_amount: amt, price_min: null, price_max: null };
}

function legacyRowToItem(row, i, kind) {
  const name = String(row?.name || '').trim();
  if (!name) return null;
  const id = String(row.id || '').trim() || (kind === 'product' ? `prd_${i}` : `svc_${slug(name)}`);
  const cat = String(row.category || '').trim();
  const unitRaw = kind === 'product' ? row.unit : (row.pricing && row.pricing.unit) || row.unit;
  const pr = legacyPrice(row);
  return {
    id,
    kind,
    name_en: name.slice(0, 160),
    aliases: Array.isArray(row.aliases) ? row.aliases.map((a) => String(a || '').trim()).filter(Boolean).slice(0, 20) : [],
    category_id: cat ? slug(cat) : null,
    category_name: cat || null,
    description_en: String(row.notes || '').trim() || null,
    unit: normUnit(unitRaw),
    ...pr,
    currency: 'KES',
    needs_visit: /site visit|visit first|after the team checks/i.test(String(row.notes || '')) && pr.price_mode === 'quote',
    in_stock: stock(row.in_stock),
    status: 'active',
    sort: i,
    source: 'legacy',
    legacy_ref: kind === 'product' ? 'product_catalog' : 'services_catalog',
  };
}

/** tenants row (or profile) -> { items, categories } for kb_upsert_items. Ids are kept; categories deduped by slug. */
function fromLegacy(row = {}) {
  const services = Array.isArray(row.services_catalog ?? row.servicesCatalog) ? (row.services_catalog ?? row.servicesCatalog) : [];
  const products = Array.isArray(row.product_catalog ?? row.productCatalog) ? (row.product_catalog ?? row.productCatalog) : [];
  const items = [];
  const seen = new Set();
  services.forEach((r, i) => { const it = legacyRowToItem(r, i, 'service'); if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); } });
  products.forEach((r, i) => { const it = legacyRowToItem(r, i, 'product'); if (it && !seen.has(it.id)) { seen.add(it.id); items.push({ ...it, sort: services.length + i }); } });
  const categories = [];
  const cats = new Map();
  for (const it of items) if (it.category_id && !cats.has(it.category_id)) { cats.set(it.category_id, true); categories.push({ id: it.category_id, name_en: it.category_name, sort: categories.length }); }
  return { items, categories };
}

const fmtNum = (n) => (Number.isInteger(Number(n)) ? Number(n).toLocaleString('en-US') : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** Display price ("KSh 2,500", "KSh 6,000–12,000", "From KSh 1,500", "Custom quote"). */
function displayPrice(it = {}) {
  switch (it.price_mode) {
    case 'fixed': case 'per_unit': return it.price_amount != null ? `KSh ${fmtNum(it.price_amount)}` : null;
    case 'range': return it.price_min != null && it.price_max != null ? `KSh ${fmtNum(it.price_min)}–${fmtNum(it.price_max)}` : null;
    case 'from': return it.price_amount != null ? `From KSh ${fmtNum(it.price_amount)}` : null;
    case 'quote': return 'Custom quote';
    case 'free': return 'Free';
    default: return null;
  }
}

/** kb items (+ category names) -> today's catalogue shapes. Hidden items are left out. */
function toLegacy(items = [], categories = []) {
  const catName = new Map((categories || []).map((c) => [c.id, c.name_en]));
  const servicesCatalog = []; const productCatalog = [];
  for (const it of items || []) {
    if (!it || it.status === 'hidden') continue;
    const price = displayPrice(it);
    const pricing = {
      mode: it.price_mode === 'per_unit' ? 'fixed' : it.price_mode, unit: it.unit || null, source: 'owner', confirmed: true,
      amount_ksh: it.price_amount != null ? Number(it.price_amount) : it.price_min != null ? Number(it.price_min) : null,
      min_ksh: it.price_min != null ? Number(it.price_min) : null, max_ksh: it.price_max != null ? Number(it.price_max) : null,
      in_stock: it.in_stock ?? null,
    };
    const base = {
      id: it.id, name: it.name_en, notes: it.description_en || '', category: catName.get(it.category_id) || it.category_name || '',
      in_stock: it.in_stock === false ? 'no' : it.in_stock === true ? 'yes' : '', source: it.source === 'legacy' ? 'owner' : it.source || 'owner',
      pricing, price_max: it.price_max != null ? Number(it.price_max) : null,
    };
    if (it.kind === 'product') {
      productCatalog.push({ ...base, sku: '', unit: it.unit ? `per ${it.unit}` : '', price: price || '', aliases: it.aliases || [], price_mode: pricing.mode });
    } else {
      servicesCatalog.push({ ...base, price: it.price_amount != null ? String(it.price_amount) : it.price_min != null ? String(it.price_min) : '', price_range: price || '', pricing_mode: pricing.mode, out_of_scope: '' });
    }
  }
  return { servicesCatalog, productCatalog };
}

module.exports = { fromLegacy, toLegacy, legacyPrice, displayPrice, normUnit, slug, fmtNum };

/** Snapshot (schema 2) items -> today's catalogue shapes, so every legacy reader reads the live KB. */
function docToLegacy(doc) {
  if (!doc || !Array.isArray(doc.items)) return null;
  const rows = doc.items.map((x) => ({
    id: x.id, kind: x.kind, name_en: x.name, category_id: x.cat, category_name: x.cat_name, description_en: x.desc, unit: x.unit,
    price_mode: x.price.mode, price_amount: x.price.amount, price_min: x.price.min, price_max: x.price.max, in_stock: x.in_stock,
    aliases: x.aliases, status: 'active', source: 'owner',
  }));
  return toLegacy(rows, []);
}
module.exports.docToLegacy = docToLegacy;
