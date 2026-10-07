import { Stamp } from "@/components/ui/Stamp";
import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";

/** One stamp per row (charter). Highest priority wins. */
export function catalogRowStamp(row: ServiceItem | ProductItem) {
  const source = String(row.source || "").toLowerCase();
  if (source === "import" || source === "seed" || source === "call_suggested") {
    return <Stamp tone="attention">Suggested</Stamp>;
  }

  const mode =
    "pricing_mode" in row && row.pricing_mode
      ? String(row.pricing_mode).toLowerCase()
      : "price_mode" in row && row.price_mode
        ? String(row.price_mode).toLowerCase()
        : "";

  if (mode === "ask") return <Stamp tone="neutral">Ask price</Stamp>;
  if (mode === "from") return <Stamp tone="neutral">From</Stamp>;
  if (mode === "range") return <Stamp tone="neutral">Range</Stamp>;

  if ("in_stock" in row && row.in_stock === "no") {
    return <Stamp tone="neutral">Out</Stamp>;
  }

  if ("site_visit_required" in row && row.site_visit_required === true) {
    return <Stamp tone="neutral">Visit</Stamp>;
  }

  if ("holdable" in row && row.holdable === true) {
    return <Stamp tone="neutral">Hold</Stamp>;
  }

  return null;
}
