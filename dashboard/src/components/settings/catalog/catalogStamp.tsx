import { Stamp } from "@/components/ui/Stamp";
import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";

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
  return null;
}
