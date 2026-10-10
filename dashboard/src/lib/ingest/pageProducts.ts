import { inferPriceMode } from "../outcomeGates";

type Row = { name: string; price?: string };

/** A product name, not a page title, heading sentence, or paragraph. */
export function looksLikeProductName(name: string): boolean {
  const text = String(name || "").trim();
  if (text.length < 2 || text.length > 80) return false;
  const words = text.split(/\s+/).length;
  if (words > 10) return false;
  if (/[.!?]$/.test(text) && words > 3) return false; // sentence
  if (/\b(welcome|about us|home|contact us|copyright|all rights reserved|privacy|cookie|menu)\b/i.test(text)) return false;
  if (/[|–—]\s*\S+/.test(text) && words > 4) return false; // "Shop name | tagline" page titles
  return true;
}

/**
 * Plain-text page scrape: every line becomes a "product" in parseBulkProducts.
 * Keep only rows that look like a sellable item AND (for the local parser) carry a price.
 */
export function filterPageProducts<T extends Row>(rows: T[], opts: { requirePrice: boolean }): T[] {
  return rows.filter((row) => {
    if (!looksLikeProductName(row.name)) return false;
    if (opts.requirePrice && !inferPriceMode(row.price || "")) return false;
    return true;
  });
}
