/**
 * Structured business data: one taxonomy (src/data/taxonomy.json, mirrored here) and the
 * parsers that turn owner text into typed facts. Used by setup, Settings, the call review
 * correction sheet and the data-quality view. Display text is derived, never the source.
 */
import taxonomy from "./taxonomy.json" with { type: "json" };

type Opt = { id: string; label: string };
export const TAXONOMY = taxonomy;
export type PricingMode = "fixed" | "from" | "range" | "ask";

export const PRICING_MODES = taxonomy.pricing_modes as Array<Opt & { id: PricingMode }>;
export const UNITS = taxonomy.units as Opt[];
export const INTENTS = taxonomy.intents as Opt[];
export const OUTCOMES = taxonomy.outcomes as Opt[];
export const LOST_REASONS = taxonomy.lost_reasons as Opt[];
export const BUSINESS_TYPES = taxonomy.business_types as Array<Opt & { categories: Opt[] }>;

const ids = (list: Opt[]) => new Set(list.map((o) => o.id));
const INTENT_IDS = ids(INTENTS);
const OUTCOME_IDS = ids(OUTCOMES);
const LOST_IDS = ids(LOST_REASONS);

export function labelOf(list: Opt[], id: string | null | undefined): string {
  return list.find((o) => o.id === id)?.label || "";
}

/** Map any stored intent (current or legacy) onto the shared taxonomy. */
export function canonicalIntent(raw: unknown): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (INTENT_IDS.has(v)) return v;
  return (taxonomy.legacy_intents as Record<string, string>)[v] || "other";
}
export const isOutcome = (v: unknown) => OUTCOME_IDS.has(String(v));
export const isLostReason = (v: unknown) => LOST_IDS.has(String(v));
export const isIntent = (v: unknown) => INTENT_IDS.has(String(v));

export function categoriesFor(businessType: string | null | undefined): Opt[] {
  return BUSINESS_TYPES.find((b) => b.id === businessType)?.categories || [];
}

/* ---------------- prices ---------------- */

export type StructuredPrice = {
  mode: PricingMode;
  amount_ksh: number | null;
  min_ksh: number | null;
  max_ksh: number | null;
  unit: string | null;
  in_stock: boolean | null;
  /** owner = typed or confirmed by the owner; parsed = read from old text, needs "Is this right?" */
  source: "owner" | "parsed";
  confirmed: boolean;
  parsed_from?: string;
};

const MAX_KSH = 100_000_000;

/** "2,500" "2.5k" "KSh 1,200/=" "1500 KES" -> number. Null when no amount. */
export function parseAmount(raw: unknown): number | null {
  const s = String(raw ?? "").toLowerCase().replace(/ksh\.?|kes|kshs|sh\.?|\/=|\s/g, "");
  const m = s.match(/^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (m[2] === "k") n *= 1_000;
  if (m[2] === "m") n *= 1_000_000;
  if (!Number.isFinite(n) || n < 0 || n > MAX_KSH) return null;
  return Math.round(n);
}

const UNIT_WORDS: Array<[RegExp, string]> = [
  [/\b(per|a|\/)\s*(kg|kilo)\b/, "kg"],
  [/\b(per|a|\/)\s*(hr|hour)\b/, "hour"],
  [/\b(per|a|\/)\s*(visit)\b/, "visit"],
  [/\b(per|a|\/)\s*(room)\b/, "room"],
  [/\b(per|a|\/)\s*(sqm|m2|square metre)\b/, "sqm"],
  [/\b(per|a|\/)\s*(litre|liter|ltr)\b/, "litre"],
  [/\b(per|a|\/)\s*(metre|meter|m)\b/, "metre"],
  [/\b(per|a|\/)\s*(pack|packet|box)\b/, "pack"],
  [/\b(per|a|\/)\s*(seat|seater)\b/, "seat"],
  [/\b(each|pc|pcs|piece)\b/, "item"],
];

/**
 * Read an old free-text price into typed fields. Never throws; anything it can't read
 * comes back as mode "ask" with no amounts so the owner is asked, not guessed for.
 */
export function parsePriceText(raw: unknown): Omit<StructuredPrice, "in_stock" | "confirmed" | "source"> {
  const text = String(raw ?? "").trim();
  const low = text.toLowerCase();
  const unit = UNIT_WORDS.find(([re]) => re.test(low))?.[1] ?? null;
  const base = { mode: "ask" as PricingMode, amount_ksh: null, min_ksh: null, max_ksh: null, unit, parsed_from: text || undefined };
  if (!text || /^(ask|call|varies|depends|tbd|on request)\b/.test(low)) return base;
  const cleaned = low
    .replace(/kshs?\.?|kes|\/=/g, " ")
    .replace(/\b(per|a)\s+[a-z²]+|\/\s*[a-z²]+|\beach\b|\bpcs?\b|\bpiece\b|\bonly\b/g, " ");
  const range = cleaned.match(/(\d[\d.,]*\s*k?)\s*(?:-|–|to)\s*(?:sh)?\s*(\d[\d.,]*\s*k?)(?![a-z])/);
  if (range) {
    const lo = parseAmount(range[1]);
    const hi = parseAmount(range[2]);
    if (lo != null && hi != null && hi >= lo) return { ...base, mode: "range", min_ksh: lo, max_ksh: hi, amount_ksh: lo };
  }
  const from = /\b(from|starting|kuanzia|min(imum)?)\b/.test(low);
  const num = cleaned.match(/(\d[\d.,]*(?:\s*k(?![a-z]))?)/);
  const amount = num ? parseAmount(num[1]) : null;
  if (amount == null) return base;
  return { ...base, mode: from ? "from" : "fixed", amount_ksh: amount, min_ksh: from ? amount : null };
}

export function stockBool(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  const v = String(raw ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "in_stock", "available"].includes(v)) return true;
  if (["no", "false", "0", "out", "out_of_stock", "sold out"].includes(v)) return false;
  return null;
}

/** Typed price from the setup wizard row: these are owner-entered numbers, so source=owner. */
export function priceFromSetup(row: { pricing_mode?: string; price?: string; price_max?: string }, unit: string | null = null): StructuredPrice {
  const mode = (["fixed", "from", "range", "ask"].includes(String(row.pricing_mode)) ? row.pricing_mode : "ask") as PricingMode;
  const lo = mode === "ask" ? null : parseAmount(row.price);
  const hi = mode === "range" ? parseAmount(row.price_max) : null;
  return {
    mode: lo == null && mode !== "ask" ? "ask" : mode,
    amount_ksh: lo,
    min_ksh: mode === "from" || mode === "range" ? lo : null,
    max_ksh: hi,
    unit,
    in_stock: null,
    source: "owner",
    confirmed: true,
  };
}

/** Display text derived from the typed price (what the prompt and old readers still see). */
export function priceLabel(p: Pick<StructuredPrice, "mode" | "amount_ksh" | "min_ksh" | "max_ksh" | "unit">): string {
  const ksh = (n: number) => `KSh ${n.toLocaleString("en-US")}`;
  const per = p.unit && p.unit !== "item" ? ` per ${labelOf(UNITS, p.unit) || p.unit}` : "";
  if (p.mode === "ask" || p.amount_ksh == null) return "Ask";
  if (p.mode === "range" && p.max_ksh != null) return `${ksh(p.min_ksh ?? p.amount_ksh)}-${p.max_ksh.toLocaleString("en-US")}${per}`;
  if (p.mode === "from") return `From ${ksh(p.amount_ksh)}${per}`;
  return `${ksh(p.amount_ksh)}${per}`;
}

/** Item needs an owner "Is this right?" when its price was read from text and not confirmed. */
/**
 * "Is this right?" only when there was text to read: a parsed number, or ambiguous text we
 * could not turn into one ("Varies", "Custom quote"). No text at all is not a check; it is
 * an unpriced item and goes to the single "Add prices" prompt.
 */
export function needsPriceConfirm(item: { pricing?: Partial<StructuredPrice> | null; text?: string | null }): boolean {
  const p = item.pricing;
  if (!p || p.source !== "parsed" || p.confirmed) return false;
  const read = String(p.parsed_from ?? item.text ?? "").trim();
  return read !== "";
}

/** No price text and no owner price: counted once under "Add prices", never one card each. */
export function isUnpriced(item: { pricing?: Partial<StructuredPrice> | null; text?: string | null }): boolean {
  const p = item.pricing;
  if (p && (p.source === "owner" || p.confirmed)) return false;
  if (p && p.mode && p.mode !== "ask") return false;
  return String(item.text ?? "").trim() === "" && String(p?.parsed_from ?? "").trim() === "";
}

/* ---------------- payments ---------------- */
// Payments live in ./payments (v2: phone numbers, Pochi, Airtel, bank, several timings, a note).
export {
  PAYMENT_METHODS,
  PAYMENT_TIMING,
  TILL_RE,
  PAYBILL_RE,
  emptyPayments,
  normalizePayments,
  validatePayments,
  cleanPayments,
  parsePaymentsText,
  paymentsSentence,
  type Payments,
  type PaymentMethod,
  type PaymentTiming,
} from "./payments";

/* ---------------- calls ---------------- */

export function timeOfDay(at: Date | string, tz = "Africa/Nairobi"): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date(at))) % 24;
  return (taxonomy.time_of_day.find((b) => h >= b.from && h < b.to) || taxonomy.time_of_day[0]).id;
}

/* ---------------- keeping typed prices in step with the text ---------------- */

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_KSH ? Math.round(n) : null;
};

/** Accepts only a well-formed typed price; anything else is dropped (and re-derived). */
export function sanitizePricing(raw: unknown): StructuredPrice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const mode = String(r.mode || "");
  if (!["fixed", "from", "range", "ask"].includes(mode)) return null;
  const unit = typeof r.unit === "string" && UNITS.some((u) => u.id === r.unit) ? r.unit : null;
  return {
    mode: mode as PricingMode,
    amount_ksh: num(r.amount_ksh),
    min_ksh: num(r.min_ksh),
    max_ksh: num(r.max_ksh),
    unit,
    in_stock: typeof r.in_stock === "boolean" ? r.in_stock : null,
    source: r.source === "parsed" ? "parsed" : "owner",
    confirmed: r.confirmed === true,
    ...(typeof r.parsed_from === "string" && r.parsed_from ? { parsed_from: r.parsed_from.slice(0, 120) } : {}),
  };
}

/**
 * Typed price for an item saved from Settings. Unchanged text keeps the stored typed price
 * (and its confirmation); new text is read now. The owner just typed it, so a clear amount is
 * trusted; text we can't read ("depends on size") stays unconfirmed and gets an "Is this right?" card.
 */
export function syncPricing(item: { pricing?: unknown; unit?: string }, text: string, inStockRaw: unknown): StructuredPrice {
  const prev = sanitizePricing(item.pricing);
  const stock = stockBool(inStockRaw);
  const t = String(text || "").trim();
  if (prev && (t === (prev.parsed_from || "") || t === priceLabel(prev) || (!t && prev.mode === "ask"))) {
    return { ...prev, in_stock: stock ?? prev.in_stock };
  }
  const parsed = parsePriceText(t);
  const unitWord = String(item.unit || "").trim().toLowerCase();
  const unit = parsed.unit || UNITS.find((u) => u.id === unitWord || u.label === unitWord)?.id || null;
  const readable = parsed.mode !== "ask" || /^(ask|call|varies|on request)\b/i.test(t);
  return { ...parsed, unit, in_stock: stock, source: "owner", confirmed: readable && Boolean(t) };
}
