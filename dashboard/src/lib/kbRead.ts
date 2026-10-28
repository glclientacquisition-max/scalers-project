/**
 * Desk reads of the catalogue text, kb_items first (pure; no server imports).
 * For a KB business the old services_catalog / product_catalog / services_offered are only a derived mirror, so Desk
 * readers (Test panel greeting preview, Settings payload, FAQ compile input) build the same values from kb_items
 * through the contract helpers (mirrorLegacy, servicesOfferedFromKb). Before the KB tables exist (prod today) callers
 * get null and keep reading the stored columns.
 */
import { mirrorLegacy, type KbCategory, type KbItem } from "./kbCore";
import { servicesOfferedFromKb } from "./kbLegacy";
import { isKbCallerBusiness, kbOpenerLine } from "./kbCaller";

export type KbCatalogueView = {
  services_catalog: unknown[];
  product_catalog: unknown[];
  services_offered: string;
  /** Greeting offering line as the call builds it (kbCaller.ts); null when there are no offered items (legacy reads). */
  offering_line: string | null;
};

export function kbCatalogueView(
  items: KbItem[],
  categories: KbCategory[],
  stored: { services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null },
): KbCatalogueView {
  const m = mirrorLegacy(items, categories, { services_catalog: stored.services_catalog ?? [], product_catalog: stored.product_catalog ?? [] });
  return {
    services_catalog: m.services_catalog,
    product_catalog: m.product_catalog,
    services_offered: servicesOfferedFromKb(items, categories, stored.services_offered),
    offering_line: isKbCallerBusiness(items) ? kbOpenerLine(items, categories) : null,
  };
}

/** The tenant row with its catalogue fields from the KB view; unchanged when there is no KB (null). */
export function withKbCatalogue<T extends { services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null }>(tenant: T, kb: KbCatalogueView | null): T {
  if (!kb) return tenant;
  const out = { ...tenant, services_catalog: kb.services_catalog, product_catalog: kb.product_catalog, services_offered: kb.services_offered };
  return kb.offering_line == null ? out : { ...out, kb_offering_line: kb.offering_line };
}
