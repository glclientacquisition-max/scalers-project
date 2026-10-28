/**
 * v2 KB, Desk side (pure): today's catalogue columns -> kb_items rows, and the one derived
 * services_offered text. Port of Voice src/knowledge/kb/items.js fromLegacy (ids, prices, units the
 * same); tests/kbLegacyParity.test.js checks both give the same rows on the staging fixtures.
 */
import { formatServicesForCompiler, extractServicesNotes, normalizeServicesCatalog } from "@/lib/servicesCatalog";
import { formatProductsForCompiler, normalizeProductCatalog } from "@/lib/productCatalog";
import { itemsFromPaste, mirrorLegacy, parsePasteList, type KbCategory, type KbItem, type KbKind, type KbPriceMode } from "@/lib/kbCore";

type Row = Record<string, unknown>;
export type KbLegacyItem = Omit<KbItem, "row_version" | "name_sw" | "name_sw_state" | "name_sw_suggested" | "popular" | "delivery_fee_kes" | "status_note"> & {
  category_name: string | null;
  currency: "KES";
};

export const kbSlug = (s: unknown): string =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "item";

const UNIT_WORDS: [RegExp, string][] = [
  [/seedling|plant|mche|miche/i, "seedling"], [/\bkg\b|kilo/i, "kg"], [/tray|trei/i, "tray"], [/\bseat\b|kiti/i, "seat"],
  [/hour|\bhr\b|hourly/i, "hour"], [/sq\.?\s*m|m²|m2|square\s*met/i, "sqm"], [/sq\.?\s*ft|square\s*f/i, "sqft"], [/\broom\b/i, "room"],
  [/window/i, "window"], [/visit/i, "visit"], [/\bjob\b/i, "job"], [/piece|\bunit\b|each|\bpc\b/i, "piece"], [/litre|liter|\bl\b/i, "litre"],
  [/\bbag\b/i, "bag"], [/\bpack\b|packet/i, "pack"], [/bunch/i, "bunch"],
];
function normUnit(raw: unknown): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  for (const [re, u] of UNIT_WORDS) if (re.test(s)) return u;
  return s.replace(/^per\s+/i, "").slice(0, 40).toLowerCase() || null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
}
function stock(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(no|false|0|out|none|sold)/.test(s)) return false;
  if (/^(yes|true|1|in|available)/.test(s)) return true;
  return null;
}
type Price = { price_mode: KbPriceMode; price_amount: number | null; price_min: number | null; price_max: number | null };

/** Same rules as Voice items.legacyPrice (a deliberate old-Desk "ask" is a quote; untouched stays none). */
export function legacyPrice(row: Row = {}): Price {
  const p = (row.pricing && typeof row.pricing === "object" ? row.pricing : {}) as Row;
  const text = String(row.price_range || row.price || "").trim();
  const modes = [p.mode, row.pricing_mode, row.price_mode].map((m) => String(m || "").toLowerCase()).filter(Boolean);
  const mode0 = modes.find((m) => m !== "ask") || modes[0] || "";
  const visit = row.site_visit_required === true || /^(yes|true)$/i.test(String(row.site_visit_required ?? ""));
  const NONE: Price = { price_mode: "none", price_amount: null, price_min: null, price_max: null };
  const quote = (): Price => ({ ...NONE, price_mode: visit ? "site_visit" : "quote" });
  if (modes.some((m) => /site.?visit/.test(m))) return { ...NONE, price_mode: "site_visit" };
  if (modes.some((m) => /quote|on\s*request|custom/.test(m)) || /custom\s+quote|on\s+request|\bquote\b/i.test(text)) return quote();
  if (/site\s+visit|after\s+(a\s+)?visit/i.test(text) && !/\d/.test(text)) return { ...NONE, price_mode: "site_visit" };
  if (/free/.test(mode0) || /^free$/i.test(text)) return { price_mode: "free", price_amount: 0, price_min: null, price_max: null };
  const parsed = num(p.parsed_from);
  const exactFixed = parsed != null && /^\s*\d[\d,]*(\.\d+)?\s*$/.test(String(p.parsed_from)) ? parsed : null;
  const lo = num(p.min_ksh) ?? null;
  const hi = num(p.max_ksh ?? row.price_max) ?? null;
  if ((mode0 === "range" || (lo != null && hi != null)) && hi != null) {
    const min = lo ?? num(p.amount_ksh) ?? num(row.price);
    return { price_mode: "range", price_amount: null, price_min: min, price_max: hi };
  }
  const amt = exactFixed ?? num(p.amount_ksh) ?? num(row.price) ?? (text ? num(text.split(/[-–]|to/)[0]) : null);
  if (amt == null) {
    const deliberateAsk = modes.includes("ask") && String(p.source || "").toLowerCase() === "owner" && p.confirmed === true;
    return deliberateAsk || visit ? quote() : NONE;
  }
  if (mode0 === "from" || /^from\b|kuanzia/i.test(text)) return { price_mode: "from", price_amount: amt, price_min: null, price_max: null };
  return { price_mode: "fixed", price_amount: amt, price_min: null, price_max: null };
}

function legacyRowToItem(row: Row, i: number, kind: KbKind): KbLegacyItem | null {
  const name = String(row?.name || "").trim();
  if (!name) return null;
  const id = String(row.id || "").trim() || (kind === "product" ? `prd_${i}` : `svc_${kbSlug(name)}`);
  const cat = String(row.category || "").trim();
  const pricing = (row.pricing && typeof row.pricing === "object" ? row.pricing : {}) as Row;
  const unitRaw = kind === "product" ? row.unit : pricing.unit || row.unit;
  const pr = legacyPrice(row);
  return {
    id,
    kind,
    name_en: name.slice(0, 160),
    aliases: Array.isArray(row.aliases) ? row.aliases.map((a) => String(a || "").trim()).filter(Boolean).slice(0, 20) : [],
    category_id: cat ? kbSlug(cat) : null,
    category_name: cat || null,
    description_en: String(row.notes || "").trim() || null,
    unit: normUnit(unitRaw),
    ...pr,
    currency: "KES",
    needs_visit:
      pr.price_mode === "site_visit" || row.site_visit_required === true ||
      (/site visit|visit first|after the team checks/i.test(String(row.notes || "")) && pr.price_mode === "quote"),
    in_stock: stock(row.in_stock),
    holdable: row.holdable === true,
    excludes_en: String(row.out_of_scope || "").trim().slice(0, 500) || null,
    status: "active",
    sort: i,
    source: "legacy",
    legacy_ref: kind === "product" ? "product_catalog" : "services_catalog",
  };
}

/** services_catalog + product_catalog -> { items, categories } for kb_upsert_items (ids kept, categories deduped). */
export function kbItemsFromLegacy(row: { services_catalog?: unknown; product_catalog?: unknown }): { items: KbLegacyItem[]; categories: { id: string; name_en: string; sort: number }[] } {
  const services = Array.isArray(row.services_catalog) ? (row.services_catalog as Row[]) : [];
  const products = Array.isArray(row.product_catalog) ? (row.product_catalog as Row[]) : [];
  const items: KbLegacyItem[] = [];
  const seen = new Set<string>();
  services.forEach((r, i) => { const it = legacyRowToItem(r, i, "service"); if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); } });
  products.forEach((r, i) => { const it = legacyRowToItem(r, i, "product"); if (it && !seen.has(it.id)) { seen.add(it.id); items.push({ ...it, sort: services.length + i }); } });
  const categories: { id: string; name_en: string; sort: number }[] = [];
  const cats = new Set<string>();
  for (const it of items) if (it.category_id && !cats.has(it.category_id)) { cats.add(it.category_id); categories.push({ id: it.category_id, name_en: it.category_name || it.category_id, sort: categories.length }); }
  return { items, categories };
}

/**
 * The ONE writer of tenants.services_offered (compat for readers not yet on the KB; dropped in phase 8):
 * derived from the business's kb_items (active services, through the same mirror the Desk editor uses),
 * plus the owner's "Additional notes" kept from the stored text. Never from browser input.
 */
export function servicesOfferedFromKb(items: KbItem[], categories: KbCategory[], storedText: string | null | undefined): string {
  const offered = items.filter((i) => i.status === "active");
  const notes = extractServicesNotes(String(storedText || ""));
  const { services_catalog, product_catalog } = mirrorLegacy(offered, categories, { services_catalog: [], product_catalog: [] });
  const services = normalizeServicesCatalog(services_catalog).filter((r) => r.name);
  if (services.length || !product_catalog.length) return formatServicesForCompiler(services, notes);
  // A shop: the old column held the product list (setup wrote it that way).
  return [formatProductsForCompiler(normalizeProductCatalog(product_catalog)), notes ? `Additional notes:\n${notes}` : ""].filter(Boolean).join("\n\n");
}

const nameKey = (s: unknown) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * ADD-ONLY: the rows that are new to the KB (id and name not already there). Never returns an existing item, so a
 * catalogue-row writer can't change an owner's state (paused, not offered, can be held, not included) or hide anything.
 */
export function newKbItemsOnly<T extends { id: string; name_en: string; kind: KbKind }>(incoming: T[], existing: Pick<KbItem, "id" | "name_en" | "kind">[]): T[] {
  const ids = new Set(existing.map((e) => e.id));
  const names = new Set(existing.map((e) => `${e.kind}:${nameKey(e.name_en)}`));
  const out: T[] = [];
  for (const it of incoming) {
    const nk = `${it.kind}:${nameKey(it.name_en)}`;
    if (ids.has(it.id) || names.has(nk)) continue;
    ids.add(it.id);
    names.add(nk);
    out.push(it);
  }
  return out;
}

/** Completion check: a business has a catalogue when it has at least one active (offered) kb item. */
export function kbCatalogueComplete(activeItems: number | null | undefined): boolean {
  return Number(activeItems || 0) > 0;
}

/**
 * The old free-text services blob -> one item per line for parsePasteList. Drops the "Services:" style headers, the
 * "Additional notes" tail and non-item sections, and turns the compiler's "name - category X - price Y" into "name - Y".
 */
export function servicesTextToPaste(text: string): string {
  const body = String(text || "").split(/\n\s*Additional notes:\s*\n?/i)[0];
  const out: string[] = [];
  let inItems = true;
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[A-Za-z &/]+:$/.test(line)) { inItems = /^(services|products|catalogue|price list)\b/i.test(line); continue; }
    if (!inItems) continue;
    const parts = line.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").split(/\s+-\s+/);
    const name = parts[0];
    const price = parts.slice(1).map((p) => p.replace(/^(price|pricing)\s+/i, "")).find((p) => /\d|quote|site visit|free/i.test(p) && !/^(category|notes?|in stock|out of scope)\b/i.test(p));
    out.push(price ? `${name} - ${price}` : name);
  }
  return out.join("\n");
}

/**
 * Old catalogue tab only: an edit to an item that already exists (same id) updates its content (name, price, unit,
 * group, notes, stock) and NEVER its owner state: status (paused / not offered / hidden), holdable, excludes_en,
 * status_note, Swahili name and popular stay as they are. A field counts as edited only when the old column differs
 * from the item's own mirror round trip, so the mirror's lossy mapping (per_unit -> fixed, paused -> out of stock)
 * never writes back.
 */
export function legacyEditsOnExisting(incoming: KbLegacyItem[], existing: KbItem[], categories: KbCategory[] = []): KbItem[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const mirrored = mirrorLegacy(existing, categories, { services_catalog: [], product_catalog: [] });
  const trip = new Map(kbItemsFromLegacy(mirrored).items.map((i) => [i.id, i]));
  const keys = ["name_en", "category_id", "description_en", "unit", "price_mode", "price_amount", "price_min", "price_max", "in_stock"] as const;
  const catIds = new Map(categories.map((c) => [kbSlug(c.name_en), c.id]));
  const out: KbItem[] = [];
  for (const it of incoming) {
    const prev = byId.get(it.id);
    const rt = trip.get(it.id);
    if (!prev || !rt) continue;
    const next: KbItem = { ...prev };
    let changed = false;
    const m = (v: string | null) => (v ? catIds.get(v) ?? v : null);
    for (const k of keys) {
      if (k === "category_id" ? m(it.category_id) === m(rt.category_id) : it[k] === rt[k]) continue;
      if (k === "in_stock" && prev.status === "paused") continue;
      if (k === "category_id") {
        next.category_id = m(it.category_id);
      } else {
        (next as Record<string, unknown>)[k] = it[k];
      }
      changed = true;
    }
    if (changed) out.push(next);
  }
  return out;
}

export type KbImportPlan = { fresh: (KbLegacyItem | KbItem)[]; edits: KbItem[]; categories: { id: string; name_en: string; sort: number }[]; kept: number };

/**
 * What a catalogue-row writer may write (onboarding, website/FAQ import, old catalogue tab), given the KB as it is:
 * new rows only, plus (old tab only) content edits on existing ids. Never a state change, never a hide.
 */
export function planLegacyImport(rows: { services_catalog?: unknown; product_catalog?: unknown }, existing: KbItem[], opts: { contentEdits?: boolean; categories?: KbCategory[] } = {}): KbImportPlan {
  const { items: raw, categories } = kbItemsFromLegacy(rows);
  // A group the owner already has (any id style) is reused by name.
  const byName = new Map((opts.categories || []).map((c) => [kbSlug(c.name_en), c.id]));
  const items = raw.map((i) => (i.category_id && byName.has(i.category_id) ? { ...i, category_id: byName.get(i.category_id) as string } : i));
  const fresh = newKbItemsOnly(items, existing);
  const edits = opts.contentEdits ? legacyEditsOnExisting(items, existing, opts.categories || []) : [];
  const have = new Set((opts.categories || []).map((c) => c.id));
  const usedCats = categories.filter((c) => !have.has(c.id) && [...fresh, ...edits].some((i) => i.category_id === c.id));
  return { fresh, edits, categories: usedCats, kept: items.length - fresh.length };
}

/** /api/tenant free text: new lines only (a name already in the Catalogue is left as the owner set it). */
export function planTextImport(text: string, existing: KbItem[], kind: KbKind): KbImportPlan {
  const rows = parsePasteList(servicesTextToPaste(text), existing).filter((r) => !r.error && !r.match_id);
  const fresh = newKbItemsOnly(itemsFromPaste(rows, kind, existing, null), existing);
  return { fresh, edits: [], categories: [], kept: rows.length - fresh.length };
}
