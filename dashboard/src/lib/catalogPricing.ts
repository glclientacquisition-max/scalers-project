/**
 * Catalogue price integrity. One place decides which typed price a saved row keeps.
 *
 * The rule: the stored row is the truth. A typed price (`pricing`) sent by the browser is
 * never trusted. When the owner did not change an item's price text in this form session
 * (or the text equals what is stored), the stored text and typed price stay, confirmation
 * included. Only edited text is read again.
 *
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
import { isUnpriced, sanitizePricing, stockBool, syncPricing, type StructuredPrice } from "./structuredData";
import { stableRowId } from "./factHash";

export type CatalogKind = "product" | "service";
export type PriceTextKey = "price" | "price_range";
type Row = Record<string, unknown>;

export const PRODUCT_ID_PREFIX = "prd_";

export function textKeyFor(kind: CatalogKind): PriceTextKey {
  return kind === "product" ? "price" : "price_range";
}

const norm = (v: unknown) => String(v ?? "").trim();
const lowerName = (row: Row | null | undefined) => norm(row?.name).toLowerCase();

/** Key the form uses to remember the price text it loaded: id when there is one, else name. */
export function rowKey(row: Row): string {
  return stableRowId(row) || `name:${lowerName(row)}`;
}

/** Price text per row as loaded into the form. Posted back so the server knows what the owner touched. */
export function catalogBaseline(rows: Row[], kind: CatalogKind): Record<string, string> {
  const key = textKeyFor(kind);
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!norm(row?.name)) continue;
    out[`${kind}:${rowKey(row)}`] = norm(row[key]);
  }
  return out;
}

export function parseBaseline(raw: unknown): Record<string, string> | null {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Row)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return null;
  }
}

/** Stored row for a posted row: stable id first, then sku (products), then name. Each stored row matches once. */
export function matchStoredRows(posted: Row[], stored: Row[]): Array<Row | null> {
  const used = new Set<number>();
  const take = (pred: (s: Row) => boolean): Row | null => {
    const i = stored.findIndex((s, idx) => !used.has(idx) && pred(s));
    if (i < 0) return null;
    used.add(i);
    return stored[i];
  };
  const out: Array<Row | null> = posted.map(() => null);
  // Pass 1: ids (a rename keeps its row).
  posted.forEach((row, i) => {
    const id = stableRowId(row);
    if (id) out[i] = take((s) => stableRowId(s) === id);
  });
  // Pass 2: sku, then name, for rows without an id match.
  posted.forEach((row, i) => {
    if (out[i]) return;
    const sku = norm(row.sku).toLowerCase();
    if (sku) out[i] = take((s) => norm(s.sku).toLowerCase() === sku);
    if (!out[i] && lowerName(row)) out[i] = take((s) => lowerName(s) === lowerName(row));
  });
  return out;
}

/**
 * Settle the text and typed price of every posted row against the stored catalogue.
 * - Owner did not touch the price text (posted text equals the text the form loaded, or the
 *   stored text): keep the stored text and stored typed price (and its confirmation).
 * - Owner typed a new price: read it now, starting from the stored typed price, never the client's.
 */
export function settleCatalogPrices<T extends Row>(
  posted: T[],
  stored: Row[],
  kind: CatalogKind,
  opts: { baseline?: Record<string, string> | null; unitFallback?: string } = {}
): T[] {
  const key = textKeyFor(kind);
  const matches = matchStoredRows(posted, stored);
  return posted.map((row, i) => {
    const prev = matches[i];
    const prevPricing = sanitizePricing(prev?.pricing);
    const text = norm(row[key]);
    const loaded = opts.baseline ? opts.baseline[`${kind}:${rowKey(row)}`] : undefined;
    const untouched = prev != null && (text === norm(prev[key]) || (loaded !== undefined && text === norm(loaded)));
    const unit = norm(row.unit) || prevPricing?.unit || opts.unitFallback || "";
    if (untouched && prev) {
      const storedText = norm(prev[key]);
      const base = prevPricing ?? syncPricing({ pricing: null, unit }, storedText, row.in_stock);
      const stock = stockBool(row.in_stock);
      const pricing: StructuredPrice = { ...base, in_stock: stock ?? base.in_stock };
      return { ...row, [key]: storedText, pricing } as T;
    }
    const pricing = syncPricing({ pricing: prevPricing, unit }, text, row.in_stock);
    return { ...row, pricing } as T;
  });
}

/** One "no price" rule for the Add prices count and the filtered list. */
export function isUnpricedRow(row: Row | null | undefined, kind: CatalogKind): boolean {
  if (!row || !norm(row.name)) return false;
  return isUnpriced({ pricing: sanitizePricing(row.pricing), text: norm(row[textKeyFor(kind)]) });
}

/** Content fingerprint of the catalogue (names, text, typed prices). Changes on any price confirm or edit. */
export function catalogContentKey(...lists: unknown[]): string {
  const s = JSON.stringify(lists.map((l) => (Array.isArray(l) ? l : [])));
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length.toString(36)}.${(h >>> 0).toString(36)}`;
}

/** Index of one item: stable id when given, else the first row with that name. */
export function findCatalogItem(rows: Row[], target: { id?: string | null; name: string }): number {
  const id = norm(target.id);
  if (id) {
    const i = rows.findIndex((r) => stableRowId(r) === id);
    if (i >= 0) return i;
  }
  const name = norm(target.name).toLowerCase();
  return rows.findIndex((r) => lowerName(r) === name);
}

/** New list with only that item patched. Null when the item is gone. */
export function patchCatalogItem<T extends Row>(rows: T[], target: { id?: string | null; name: string }, patch: (row: T) => T): T[] | null {
  const i = findCatalogItem(rows, target);
  if (i < 0) return null;
  return rows.map((r, idx) => (idx === i ? patch(r) : r));
}

/** Typed price for an imported item that has none yet (import and pasted lists). */
export function withImportedPricing<T extends Row>(row: T, kind: CatalogKind, source: "owner" | "parsed" = "parsed"): T {
  if (sanitizePricing(row.pricing)) return row;
  const text = norm(row[textKeyFor(kind)]);
  if (!text) return row;
  const p = syncPricing({ pricing: null, unit: norm(row.unit) }, text, row.in_stock);
  // An import is read from someone else's text: keep it unconfirmed so the owner gets "Is this right?".
  const pricing: StructuredPrice =
    source === "owner" ? p : { ...p, source: "parsed", confirmed: false, parsed_from: text.slice(0, 120) };
  return { ...row, pricing } as T;
}

/** catalog.<kind>.<key>.price for the row at `index` (service: stable id, product: sku, else its position). */
export function catalogPricePath(kind: CatalogKind, rows: Row[], index: number): string | null {
  const row = index >= 0 ? rows[index] : undefined;
  if (!row || typeof row !== "object") return null;
  const key = kind === "service" ? stableRowId(row) || String(index + 1) : norm(row.sku) || String(index + 1);
  return `catalog.${kind}.${key}.price`;
}
