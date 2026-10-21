/**
 * Owner price confirms, one or many (Catalogue "Is this right?" card and the
 * Overview prices sheet), as ONE catalogue write, ONE value_hash re-stamp and
 * ONE prompt rebuild, however many prices were confirmed.
 *
 * Before: the Overview sheet ran the whole single-price save per item (fresh
 * read, tenants update, hash read + confirm RPC, compile provenance, compile,
 * prompt update), so 10 prices meant 10 prompt rebuilds.
 *
 * Pure apart from the injected deps, so node tests can count round trips.
 */
import { catalogPricePath, findCatalogItem, patchCatalogItem } from "./catalogPricing";
import { confirmPriceFields, sanitizePricing, type StructuredPrice } from "./structuredData";

export type PriceConfirmInput = {
  kind: "product" | "service";
  id?: string | null;
  name: string;
  pricing: StructuredPrice;
};

export type PriceBatchResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fields?: Record<string, string> };

type Row = Record<string, unknown>;
export type CatalogColumn = "product_catalog" | "services_catalog";
export type CatalogColumns = Partial<Record<CatalogColumn, Row[]>>;
export type FreshCatalogRow = { product_catalog?: unknown; services_catalog?: unknown };

export const PRICE_SAVE_FAILED = "Couldn't save. Nothing was changed. Try again.";

/** Owner pricing as the single-price action stored it, or the owner-facing error. */
export function ownerPricing(
  raw: StructuredPrice
): { ok: true; pricing: StructuredPrice } | { ok: false; error: string; fields?: Record<string, string> } {
  const pricing = sanitizePricing({ ...raw, source: "owner", confirmed: true });
  if (!pricing) return { ok: false, error: "Pick how this is priced." };
  if (pricing.mode !== "ask" && pricing.amount_ksh == null) {
    return { ok: false, error: "Add the price in KSh.", fields: { amount: "Add the price in KSh." } };
  }
  if (pricing.mode === "range" && (pricing.max_ksh == null || pricing.max_ksh < (pricing.amount_ksh ?? 0))) {
    return {
      ok: false,
      error: "The top of the range must be higher.",
      fields: { max: "The top of the range must be higher." },
    };
  }
  if (pricing.mode === "from" || pricing.mode === "range") pricing.min_ksh = pricing.amount_ksh;
  if (pricing.mode !== "range") pricing.max_ksh = null;
  if (pricing.mode === "ask") Object.assign(pricing, { amount_ksh: null, min_ksh: null, max_ksh: null });
  return { ok: true, pricing };
}

export function columnFor(kind: "product" | "service"): CatalogColumn {
  return kind === "product" ? "product_catalog" : "services_catalog";
}

/**
 * Apply every confirmed price to one in-memory copy of the catalogue. Every
 * price is validated first: one bad price saves nothing.
 */
export function applyPriceBatch(
  fresh: FreshCatalogRow,
  inputs: PriceConfirmInput[]
): { ok: true; columns: CatalogColumns } | { ok: false; error: string; fields?: Record<string, string> } {
  const priced: Array<{ input: PriceConfirmInput; pricing: StructuredPrice }> = [];
  for (const input of inputs) {
    const res = ownerPricing(input.pricing);
    if (!res.ok) return res;
    priced.push({ input, pricing: res.pricing });
  }
  const columns: CatalogColumns = {};
  for (const { input, pricing } of priced) {
    const column = columnFor(input.kind);
    const textKey = input.kind === "product" ? "price" : "price_range";
    const current = columns[column] ?? (Array.isArray(fresh[column]) ? (fresh[column] as Row[]) : []);
    // Patch only this item, found by id (else name), on the copy as stored now.
    const next = patchCatalogItem(current, { id: input.id, name: input.name }, (row) => {
      const decided = confirmPriceFields({
        storedText: String(row[textKey] ?? ""),
        storedPricing: sanitizePricing(row.pricing),
        incoming: pricing,
      });
      return { ...row, pricing: decided.pricing, [textKey]: decided.text, source: "owner" };
    });
    if (!next) return { ok: false, error: "That item is no longer in your catalogue." };
    columns[column] = next;
  }
  return { ok: true, columns };
}

/**
 * The .price and .name paths to re-stamp for every confirmed item, against the
 * rows as written. The save may rewrite price/price_range, which is part of the
 * row's .name value, so .name is re-stamped too or "yes, unchanged" goes stale.
 */
export function priceStampPaths(columns: CatalogColumns, inputs: PriceConfirmInput[]): string[] {
  const out = new Set<string>();
  for (const input of inputs) {
    const rows = columns[columnFor(input.kind)] ?? [];
    const path = catalogPricePath(input.kind, rows, findCatalogItem(rows, { id: input.id, name: input.name }));
    if (!path) continue;
    out.add(path);
    out.add(path.replace(/\.price$/, ".name"));
  }
  return [...out];
}

export type PriceBatchDeps = {
  /** The catalogue columns as stored now (past the tenant cache). */
  readFresh: () => Promise<FreshCatalogRow | null>;
  /** One tenants UPDATE with every changed catalogue column. */
  write: (columns: CatalogColumns) => Promise<{ error: unknown }>;
  /** One value_hash re-stamp for every path. Must not throw. */
  restamp: (paths: string[], columns: CatalogColumns) => Promise<void>;
  /** One prompt rebuild from the saved catalogue. Must not throw. */
  recompile: (fresh: FreshCatalogRow, columns: CatalogColumns) => Promise<unknown>;
};

export async function runPriceBatch(deps: PriceBatchDeps, inputs: PriceConfirmInput[]): Promise<PriceBatchResult> {
  if (!inputs.length) return { ok: false, error: "Nothing to save." };
  // Validate before touching the database, so a bad price never reads or writes.
  for (const input of inputs) {
    const res = ownerPricing(input.pricing);
    if (!res.ok) return res;
  }
  const fresh = await deps.readFresh();
  if (!fresh) return { ok: false, error: PRICE_SAVE_FAILED };
  const applied = applyPriceBatch(fresh, inputs);
  if (!applied.ok) return applied;
  const { error } = await deps.write(applied.columns);
  if (error) return { ok: false, error: PRICE_SAVE_FAILED };
  // The owner just confirmed these prices: re-stamp their hashes against the
  // rows as saved, so the rewrite does not leave a stale value_hash.
  await deps.restamp(priceStampPaths(applied.columns, inputs), applied.columns);
  // The prompt quotes prices: rebuild it once with every confirmed price.
  await deps.recompile(fresh, applied.columns);
  return { ok: true, message: inputs.length === 1 ? "Price saved." : "Prices saved." };
}
