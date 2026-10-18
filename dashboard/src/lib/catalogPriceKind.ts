/**
 * Structured catalogue prices for Desk (price_kind / price_min / price_max).
 * Voice reads these column names on normalized rows; JSON catalogue rows mirror them.
 */
import { parseAmount, parsePriceText, priceFromSetup, type StructuredPrice } from "./structuredData";

export type PriceKind = "fixed" | "from" | "range" | "quote";

export type ParsedCataloguePrice = {
  kind: PriceKind;
  min: number | null;
  max: number | null;
};

export type CatalogPriceFieldErrors = {
  min?: string;
  max?: string;
};

const KINDS = new Set<PriceKind>(["fixed", "from", "range", "quote"]);

export function isPriceKind(raw: unknown): raw is PriceKind {
  return typeof raw === "string" && KINDS.has(raw as PriceKind);
}

/** Map legacy pricing_mode / internal ask to price_kind. */
export function pricingModeToKind(raw: unknown): PriceKind | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "quote" || v === "ask") return "quote";
  if (v === "fixed" || v === "from" || v === "range") return v;
  return null;
}

/** Stored pricing_mode for JSON rows (quote, not ask). */
export function kindToPricingMode(kind: PriceKind): string {
  return kind;
}

export function kindToPricingJsonMode(kind: PriceKind): StructuredPrice["mode"] {
  return kind === "quote" ? "ask" : kind;
}

const money = (n: number) => `KSh ${n.toLocaleString("en-US")}`;

/** Legacy price text column: empty for quote. */
export function formatCatalogueLegacyPrice(kind: PriceKind, min: number | null, max: number | null): string {
  if (kind === "quote") return "";
  if (kind === "from" && min != null) return `From ${money(min)}`;
  if (kind === "range" && min != null && max != null) {
    return `${money(min)}–${max.toLocaleString("en-US")}`;
  }
  if (kind === "fixed" && min != null) return money(min);
  return "";
}

/**
 * Parse free-text catalogue prices into structured fields.
 * Empty string → quote (documented). No number → quote.
 */
export function parseCataloguePriceText(raw: unknown): ParsedCataloguePrice {
  const text = String(raw ?? "").trim();
  if (!text) return { kind: "quote", min: null, max: null };
  const parsed = parsePriceText(text);
  if (parsed.mode === "ask") return { kind: "quote", min: null, max: null };
  if (parsed.mode === "range") {
    return { kind: "range", min: parsed.min_ksh, max: parsed.max_ksh };
  }
  if (parsed.mode === "from") return { kind: "from", min: parsed.amount_ksh, max: null };
  if (parsed.mode === "fixed" && parsed.amount_ksh != null) {
    return { kind: "fixed", min: parsed.amount_ksh, max: null };
  }
  return { kind: "quote", min: null, max: null };
}

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

export function amountsFromInputs(kind: PriceKind, minInput: string, maxInput: string): ParsedCataloguePrice {
  const min = kind === "quote" ? null : parseAmount(minInput);
  const max = kind === "range" ? parseAmount(maxInput) : null;
  return { kind, min, max };
}

export type CatalogPriceRow = {
  price_kind?: string | null;
  price_min?: number | null;
  price_max?: number | null;
  pricing_mode?: string | null;
  price_range?: string | null;
  price?: string | null;
  pricing?: StructuredPrice | null;
};

/** Fill price_kind/min/max from legacy text when missing. */
export function hydrateCatalogPriceFields<T extends CatalogPriceRow>(row: T): T {
  if (isPriceKind(row.price_kind)) return row;
  const text = String(row.price_range ?? row.price ?? "").trim();
  const fromMode = pricingModeToKind(row.pricing_mode);
  const parsed = parseCataloguePriceText(text);
  const kind = fromMode ?? parsed.kind;
  const min = row.price_min ?? parsed.min;
  const max = row.price_max ?? parsed.max;
  return {
    ...row,
    price_kind: kind,
    price_min: kind === "quote" ? null : min,
    price_max: kind === "range" ? max : null,
    pricing_mode: kindToPricingMode(kind),
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
  const { min, max } = amountsFromInputs(kind, minInput, maxInput);
  const legacy = formatCatalogueLegacyPrice(kind, min, max);
  const setup = priceFromSetup(
    {
      pricing_mode: kind === "quote" ? "ask" : kind,
      price: min != null ? String(min) : "",
      price_max: max != null ? String(max) : "",
    },
    null
  );
  const pricing: StructuredPrice =
    kind === "quote"
      ? { ...setup, mode: "ask", source: "owner", confirmed: true }
      : { ...setup, source: "owner", confirmed: true };
  return {
    ...row,
    price_kind: kind,
    price_min: kind === "quote" ? null : min,
    price_max: kind === "range" ? max : null,
    pricing_mode: kindToPricingMode(kind),
    [textKey]: legacy,
    pricing,
  } as T;
}

export function catalogPriceInputsFromRow(row: CatalogPriceRow): {
  kind: PriceKind;
  minInput: string;
  maxInput: string;
} {
  const hydrated = hydrateCatalogPriceFields(row);
  const kind = isPriceKind(hydrated.price_kind) ? hydrated.price_kind : "fixed";
  const minInput =
    hydrated.price_min != null ? String(hydrated.price_min) : kind !== "quote" ? "" : "";
  const maxInput = hydrated.price_max != null ? String(hydrated.price_max) : "";
  return { kind, minInput, maxInput };
}
