import {
  catalogImportPriceLabel,
  catalogImportPriceTypeLabel,
  type CatalogPriceRow,
} from "@/lib/catalogPricingMode";

function catalogImportPriceHint(row: CatalogPriceRow): string {
  const typeLabel = catalogImportPriceTypeLabel(row);
  const display = catalogImportPriceLabel(row);
  if (!display || (typeLabel === "Quote" && display === "Quote")) return typeLabel;
  return `${typeLabel} · ${display}`;
}

export function CatalogImportPriceLine({
  row,
  className = "truncate text-meta text-ink-2",
}: {
  row: CatalogPriceRow;
  className?: string;
}) {
  const typeLabel = catalogImportPriceTypeLabel(row);
  const display = catalogImportPriceLabel(row);
  const showDisplay = Boolean(display) && !(typeLabel === "Quote" && display === "Quote");

  return (
    <p className={className}>
      <span className="text-ink-3">{typeLabel}</span>
      {showDisplay ? <span> · {display}</span> : null}
    </p>
  );
}

/** SettingsRow `hint` strings (products import, ingest). */
export function catalogImportPriceHintText(row: CatalogPriceRow): string {
  return catalogImportPriceHint(row);
}
