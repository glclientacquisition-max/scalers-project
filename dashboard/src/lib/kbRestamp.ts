import { stableRowId } from "@/lib/factHash";

/**
 * Which catalogue fact paths to re-stamp after an owner KB write (Catalogue editor, Paste a list, Import confirm).
 * The `.name` hash covers the whole mirrored row, so any edit (or a mirror rewrite of the row) makes it stale.
 *  - Items the owner just wrote (ids): `.name`, plus `.price` when the mirrored price is a confirmed owner price.
 *  - Rows the owner had already confirmed before (ownerPaths): re-stamped as they now read, so a mirror rewrite of
 *    an unchanged row does not drop it from the grounded catalogue. Seed / parsed rows are never promoted.
 */
type Row = Record<string, unknown>;

const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((r) => r && typeof r === "object") as Row[]) : []);

export function catalogRestampPaths(saved: Row, ids: Iterable<string>, ownerPaths: Iterable<string> = []): string[] {
  const want = new Set([...ids].map(String));
  const owner = new Set(ownerPaths);
  const out: string[] = [];
  for (const kind of ["service", "product"] as const) {
    asList(kind === "service" ? saved.services_catalog : saved.product_catalog).forEach((row, index) => {
      const key = kind === "service" ? stableRowId(row) || String(index + 1) : String(row.sku ?? "").trim() || String(index + 1);
      const name = `catalog.${kind}.${key}.name`;
      const price = `catalog.${kind}.${key}.price`;
      const pricing = (row.pricing && typeof row.pricing === "object" ? row.pricing : {}) as Row;
      const ownerPrice = pricing.confirmed === true && pricing.source === "owner";
      if (want.has(String(row.id ?? ""))) {
        out.push(name);
        if (ownerPrice) out.push(price);
        return;
      }
      if (owner.has(name)) out.push(name);
      if (owner.has(price) && ownerPrice) out.push(price);
    });
  }
  return [...new Set(out)];
}
