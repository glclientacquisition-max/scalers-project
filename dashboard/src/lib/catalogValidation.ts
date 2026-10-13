import { inferPriceMode } from "./outcomeGates";

type Row = { name?: string | null; price?: string | null; price_range?: string | null };

/** A blank price is fine (ask on the call). A filled price must read as a real, non-negative amount or mode. */
export function priceTextError(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  return inferPriceMode(text) ? null : `"${text}" isn't a price. Use e.g. 150, from 300, 200-400, or ask.`;
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
