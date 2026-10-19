import { inferPriceMode } from "./outcomeGates";
import { parsePriceText } from "./structuredData";

type Row = { name?: string | null; price?: string | null; price_range?: string | null };

const PRICE_HINT = "Use e.g. 150, from 300, 200-400, or ask.";

/** Owner wording for a price with no amount ("depends on size", "price depends", "quote after visit"). */
export function isAskPriceWording(raw: string | null | undefined): boolean {
  return /\b(?:ask|call|varies|depends|tbd|quoted|quotes?|quotations?|on request)\b/i.test(String(raw ?? ""));
}

function negativePrice(text: string): boolean {
  const lower = text.toLowerCase();
  return /(^|[^\d])-\s*\d/.test(lower) && !/\d\s*(?:-|to)\s*\d/.test(lower);
}

/**
 * A blank price is fine. A number, a range, or the owner's own ask wording is fine.
 * The words stay as typed. Only a negative or a line that is not a price is rejected.
 * parsePriceText is the same reader Paste list uses.
 */
export function priceTextError(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (negativePrice(text)) return `"${text}" isn't a price. ${PRICE_HINT}`;
  if (inferPriceMode(text) || isAskPriceWording(text)) return null;
  const parsed = parsePriceText(text);
  if (parsed.mode === "fixed" || parsed.mode === "from" || parsed.mode === "range" || parsed.amount_ksh != null) {
    return null;
  }
  return `"${text}" isn't a price. ${PRICE_HINT}`;
}

export type CatalogPriceIssue = { name: string; message: string };

/** Form field key for the inline message under that catalogue row. */
export function catalogPriceFieldKey(name: string): string {
  return `catalog-price:${name.trim().toLowerCase()}`;
}

/** Page alert. When some rows were written, say so. */
export function priceIssueSummary(issues: CatalogPriceIssue[], saved: boolean): string {
  const lines = issues.map((issue) => issue.message).join(" ");
  if (!saved || !lines) return lines;
  return `${lines} The rest was saved.`;
}

/**
 * Rows the save can keep. A bad new row is left out. A bad edit of a saved row
 * keeps the saved row. The issue list is what the form shows on that row.
 */
export function omitUnsavedPrices<T extends Row>(
  rows: T[] | undefined,
  field: "price" | "price_range",
  stored: T[] = []
): { rows: T[]; issues: CatalogPriceIssue[] } {
  const storedByName = new Map<string, T>();
  for (const row of stored) {
    const key = String(row.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (key && !storedByName.has(key)) storedByName.set(key, row);
  }
  const issues: CatalogPriceIssue[] = [];
  const kept: T[] = [];
  for (const row of rows || []) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const err = priceTextError(row[field]);
    if (!err) {
      kept.push(row);
      continue;
    }
    issues.push({ name, message: `${name}: ${err}` });
    const prev = storedByName.get(name.toLowerCase().replace(/\s+/g, " "));
    if (prev) kept.push(prev);
  }
  return { rows: kept, issues };
}

export function catalogSaveError(input: { products?: Row[]; services?: Row[] }): string | null {
  const check = (rows: Row[] | undefined, field: "price" | "price_range", kind: string) => {
    const seen = new Set<string>();
    for (const row of rows || []) {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      const err = priceTextError(row[field]);
      if (err) return `${name}: ${err}`;
      const key = name.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return `"${name}" is listed twice in your ${kind}.`;
      seen.add(key);
    }
    return null;
  };
  return check(input.products, "price", "products") || check(input.services, "price_range", "services");
}
