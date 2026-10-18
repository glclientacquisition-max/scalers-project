/**
 * Structured catalogue prices for Desk: pricing_mode / price / price_max (+ legacy text).
 * JSON catalogue rows on tenants (services_catalog / product_catalog) use these field names.
 */
import { parseAmount, parsePriceText, priceFromSetup, type StructuredPrice } from "./structuredData";

export type PriceKind = "fixed" | "from" | "range" | "quote";

export type ParsedCataloguePrice = {
  kind: PriceKind;
  price: number | null;
  priceMax: number | null;
};

export type CatalogPriceFieldErrors = {
  min?: string;
  max?: string;
};

const KINDS = new Set<PriceKind>(["fixed", "from", "range", "quote"]);

export function isPriceKind(raw: unknown): raw is PriceKind {
  return typeof raw === "string" && KINDS.has(raw as PriceKind);
}

/** Map stored pricing_mode / legacy ask to editor kind. */
export function pricingModeToKind(raw: unknown): PriceKind | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "quote" || v === "ask") return "quote";
  if (v === "fixed" || v === "from" || v === "range") return v;
  return null;
}

/** Stored pricing_mode on saved rows (quote, not ask). */
export function kindToPricingMode(kind: PriceKind): string {
  return kind;
}

export function kindToPricingJsonMode(kind: PriceKind): StructuredPrice["mode"] {
  return kind === "quote" ? "ask" : kind;
}

const money = (n: number) => `KSh ${n.toLocaleString("en-US")}`;

/** Legacy price text column: empty for quote. */
export function formatCatalogueLegacyPrice(
  kind: PriceKind,
  price: number | null,
  priceMax: number | null
): string {
  if (kind === "quote") return "";
  if (kind === "from" && price != null) return `From ${money(price)}`;
  if (kind === "range" && price != null && priceMax != null) {
    return `${money(price)}–${priceMax.toLocaleString("en-US")}`;
  }
  if (kind === "fixed" && price != null) return money(price);
  return "";
}

function amountString(n: number | null): string {
  return n != null && n > 0 ? String(n) : "";
}

/**
 * Parse free-text catalogue prices into structured fields.
 * Empty string → quote. No number → quote.
 */
export function parseCataloguePriceText(raw: unknown): ParsedCataloguePrice {
  const text = String(raw ?? "").trim();
  if (!text) return { kind: "quote", price: null, priceMax: null };
  const parsed = parsePriceText(text);
  if (parsed.mode === "ask") return { kind: "quote", price: null, priceMax: null };
  if (parsed.mode === "range") {
    return { kind: "range", price: parsed.min_ksh, priceMax: parsed.max_ksh };
  }
  if (parsed.mode === "from") return { kind: "from", price: parsed.amount_ksh, priceMax: null };
  if (parsed.mode === "fixed" && parsed.amount_ksh != null) {
    return { kind: "fixed", price: parsed.amount_ksh, priceMax: null };
  }
  return { kind: "quote", price: null, priceMax: null };
}

/** Import docs name; same parser as Desk structured prices. */
export const parseCatalogPricingMode = parseCataloguePriceText;

export function numericPriceInputError(raw: string, opts: { required?: boolean } = {}): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return opts.required ? "Enter an amount above 0, like 1500." : null;
  if (!/^[\d,]+$/.test(text)) return "Use numbers only.";
  const n = parseAmount(text);
  if (n == null || n <= 0) return "Enter an amount above 0, like 1500.";
  return null;
}

export function validateCatalogPriceFields(
  kind: PriceKind,
  minInput: string,
  maxInput: string
): CatalogPriceFieldErrors {
  if (kind === "quote") return {};
  const errors: CatalogPriceFieldErrors = {};
  const minErr = numericPriceInputError(minInput, { required: true });
  if (minErr) errors.min = minErr;
  if (kind === "range") {
    const maxErr = numericPriceInputError(maxInput, { required: true });
    if (maxErr) errors.max = maxErr;
    else if (!minErr) {
      const lo = parseAmount(minInput);
      const hi = parseAmount(maxInput);
      if (lo != null && hi != null && hi < lo) errors.max = "Must be at least the lowest amount.";
    }
  }
  return errors;
}

export function amountsFromInputs(
  kind: PriceKind,
  minInput: string,
  maxInput: string
): ParsedCataloguePrice {
  const price = kind === "quote" ? null : parseAmount(minInput);
  const priceMax = kind === "range" ? parseAmount(maxInput) : null;
  return { kind, price, priceMax };
}

export type CatalogPriceRow = {
  pricing_mode?: string | null;
  price_mode?: string | null;
  price?: string | null;
  price_max?: number | string | null;
  price_range?: string | null;
  pricing?: StructuredPrice | null;
};

function readStoredPrice(row: CatalogPriceRow): number | null {
  const raw = row.price;
  if (raw === undefined || raw === null || raw === "") return null;
  const text = String(raw).trim();
  if (!/^[\d,]+$/.test(text)) return null;
  const n = parseAmount(text);
  return n != null && n > 0 ? n : null;
}

function readStoredMax(row: CatalogPriceRow): number | null {
  const raw = row.price_max;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseAmount(String(raw));
  return n != null && n > 0 ? n : null;
}

/** Products use `price` as display text; services use `price_range` and optional structured `price`. */
function usesPriceAsDisplayColumn(row: CatalogPriceRow): boolean {
  return !String(row.price_range ?? "").trim();
}

/** Keep owner/import wording on display columns; structured `price` on services stays digits-only. */
function visiblePriceField(
  row: CatalogPriceRow,
  kind: PriceKind,
  parsedAmount: number | null
): string {
  if (kind === "quote") {
    const display = usesPriceAsDisplayColumn(row)
      ? String(row.price ?? "").trim()
      : String(row.price_range ?? "").trim();
    return display;
  }
  const original = String(row.price ?? "").trim();
  if (usesPriceAsDisplayColumn(row) && original) return original;
  if (original && !/^[\d,]+$/.test(original)) return original;
  return amountString(parsedAmount);
}

/** Fill pricing_mode / price / price_max from legacy text when missing. */
export function hydrateCatalogPriceFields<T extends CatalogPriceRow>(row: T): T {
  const fromMode = pricingModeToKind(row.pricing_mode ?? row.price_mode);
  if (fromMode && (fromMode === "quote" || readStoredPrice(row) != null || readStoredMax(row) != null)) {
    const amount = readStoredPrice(row);
    return {
      ...row,
      pricing_mode: kindToPricingMode(fromMode),
      price: visiblePriceField(row, fromMode, amount),
      price_max: fromMode === "range" ? readStoredMax(row) : null,
    };
  }
  const text = String(row.price_range ?? row.price ?? "").trim();
  const parsed = parseCataloguePriceText(text);
  const kind = fromMode ?? parsed.kind;
  const price = readStoredPrice(row) ?? parsed.price;
  const priceMax = readStoredMax(row) ?? parsed.priceMax;
  return {
    ...row,
    pricing_mode: kindToPricingMode(kind),
    price: visiblePriceField(row, kind, price),
    price_max: kind === "range" ? priceMax : null,
  };
}

/** Apply structured price choice to a catalogue row (services or products). */
export function applyCatalogPriceFields<T extends CatalogPriceRow>(
  row: T,
  kind: PriceKind,
  minInput: string,
  maxInput: string,
  textKey: "price" | "price_range"
): T {
  const { price, priceMax } = amountsFromInputs(kind, minInput, maxInput);
  const legacy = formatCatalogueLegacyPrice(kind, price, priceMax);
  const setup = priceFromSetup(
    {
      pricing_mode: kind === "quote" ? "ask" : kind,
      price: amountString(price),
      price_max: amountString(priceMax),
    },
    null
  );
  const pricing: StructuredPrice =
    kind === "quote"
      ? { ...setup, mode: "ask", source: "owner", confirmed: true }
      : { ...setup, source: "owner", confirmed: true };
  const mode = kindToPricingMode(kind);
  return {
    ...row,
    pricing_mode: mode,
    price_mode: mode,
    price: kind === "quote" ? "" : amountString(price),
    price_max: kind === "range" ? priceMax : null,
    [textKey]: legacy,
    pricing,
  } as T;
}

/**
 * Import paths only: derive pricing_mode / price / price_max from display text.
 * Never rewrite price_range (services) or price (products); owner wording and units stay as typed.
 */
export function structureImportedCatalogRow<T extends CatalogPriceRow>(
  row: T,
  textKey: "price" | "price_range"
): T {
  const display = String(row[textKey] ?? "");
  const parsed = parseCataloguePriceText(display.trim());
  const mode = kindToPricingMode(parsed.kind);
  const priceMax = parsed.kind === "range" ? parsed.priceMax : null;

  if (textKey === "price_range") {
    return {
      ...row,
      pricing_mode: mode,
      price_mode: mode,
      price: parsed.kind === "quote" ? "" : amountString(parsed.price),
      price_max: priceMax,
      price_range: display,
    } as T;
  }

  return {
    ...row,
    pricing_mode: mode,
    price_mode: mode,
    price_max: priceMax,
    price: display,
  } as T;
}

const IMPORT_PRICE_TYPE_LABELS: Record<PriceKind, string> = {
  fixed: "Fixed",
  from: "From",
  range: "Range",
  quote: "Quote",
};

/** Muted type chip text for import previews (Fixed, From, Range, Quote). */
export function catalogImportPriceTypeLabel(row: CatalogPriceRow): string {
  const hydrated = hydrateCatalogPriceFields(row);
  let kind = pricingModeToKind(hydrated.pricing_mode ?? hydrated.price_mode);
  if (!kind) {
    const display = usesPriceAsDisplayColumn(hydrated)
      ? String(hydrated.price ?? "").trim()
      : String(hydrated.price_range ?? "").trim();
    kind = parseCataloguePriceText(display).kind;
  }
  return IMPORT_PRICE_TYPE_LABELS[kind];
}

/** Preview line for import UIs; shows owner display text when present. */
export function catalogImportPriceLabel(row: CatalogPriceRow): string {
  const hydrated = hydrateCatalogPriceFields(row);
  const kind = pricingModeToKind(hydrated.pricing_mode ?? hydrated.price_mode) ?? "fixed";
  const display = usesPriceAsDisplayColumn(hydrated)
    ? String(hydrated.price ?? "").trim()
    : String(hydrated.price_range ?? "").trim();
  if (display) return display;
  if (kind === "quote") return "Quote";
  const price = readStoredPrice(hydrated);
  const priceMax = readStoredMax(hydrated);
  return formatCatalogueLegacyPrice(kind, price, priceMax) || "Quote";
}

export function catalogPriceInputsFromRow(row: CatalogPriceRow): {
  kind: PriceKind;
  minInput: string;
  maxInput: string;
} {
  const hydrated = hydrateCatalogPriceFields(row);
  const kind = pricingModeToKind(hydrated.pricing_mode ?? hydrated.price_mode) ?? "fixed";
  const minInput =
    kind === "quote"
      ? ""
      : hydrated.price != null && String(hydrated.price).trim()
        ? String(hydrated.price).replace(/,/g, "")
        : "";
  const maxInput =
    hydrated.price_max != null && hydrated.price_max !== ""
      ? String(hydrated.price_max).replace(/,/g, "")
      : "";
  return { kind, minInput, maxInput };
}
