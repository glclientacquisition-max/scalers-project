/**
 * What a caller-facing reader sees for a KB business (pure; no server imports). Desk twin of the KB mode in
 * Voice src/knowledge/kb/source.js + kb/live.attach, so the "What it will say" page, the lookup preview and the
 * Test greeting preview follow the same rules as the call:
 *  - only offered (active) items are listed; paused / not offered / hidden never are;
 *  - the old free-text services line (services_offered, a derived copy) is never read, so its notes are empty;
 *  - the greeting names groups (categories), never single items, and only when there is more than one group.
 * A business with no offered kb_items (or no KB tables, prod today) keeps the legacy reads unchanged.
 */
import { mirrorLegacy, type KbCategory, type KbItem } from "./kbCore";

const OFF = new Set(["paused", "not_offered", "hidden"]);

/** Offered items in the compile's order (sort, then id). */
export function offeredKbItems(items: readonly KbItem[]): KbItem[] {
  return items
    .filter((x) => x && !OFF.has(x.status) && String(x.name_en || "").trim())
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)));
}

/** A KB business for caller reads: at least one offered item. */
export function isKbCallerBusiness(items: readonly KbItem[] | null | undefined): boolean {
  return Array.isArray(items) && offeredKbItems(items).length > 0;
}

function joinList(xs: string[]): string {
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Group names a caller hears, compile order (first offered item of each group), named groups only. */
export function kbGroupNames(items: readonly KbItem[], categories: readonly KbCategory[]): string[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const order: string[] = [];
  for (const it of offeredKbItems(items)) {
    const id = it.category_id || "_other";
    if (!order.includes(id)) order.push(id);
  }
  return order
    .map((id) => (cats.get(id)?.name_en || (id === "_other" ? "" : id)).trim().toLowerCase())
    .filter(Boolean);
}

/** Twin of source.js openerLine('en'): "We help with a, b and c." for two or more groups, else "". */
export function kbOpenerLine(items: readonly KbItem[], categories: readonly KbCategory[]): string {
  const names = kbGroupNames(items, categories);
  return names.length > 1 ? `We help with ${joinList(names.slice(0, 3))}.` : "";
}

type CatalogueRow = { services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null };

/**
 * The tenant row a caller-facing reader gets for a KB business: catalogue columns hold offered items only and
 * services_offered is empty (Voice attach sets servicesOffered null). Not a KB business: unchanged.
 */
export function kbCallerRow<T extends CatalogueRow>(tenant: T, items: readonly KbItem[] | null, categories: readonly KbCategory[]): T {
  if (!items || !isKbCallerBusiness(items)) return tenant;
  const m = mirrorLegacy(offeredKbItems(items), [...categories], {
    services_catalog: tenant.services_catalog ?? [],
    product_catalog: tenant.product_catalog ?? [],
  });
  return { ...tenant, services_catalog: m.services_catalog, product_catalog: m.product_catalog, services_offered: null };
}

/** Desk fact profile in KB mode: the speech fact sheet (provenance.ts) then leaves notes empty, like Voice. */
export function kbFactProfile<P extends Record<string, unknown>>(profile: P, kb: boolean): P & { kbMode?: true } {
  return kb ? { ...profile, kbMode: true as const, servicesOffered: null } : profile;
}
