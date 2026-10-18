/**
 * Structured business data: one taxonomy (src/data/taxonomy.json, mirrored here) and the
 * parsers that turn owner text into typed facts. Used by setup, Settings, the call review
 * correction sheet and the data-quality view. A generated label is shown only when it
 * still carries every word the owner wrote. Otherwise the original wording stays.
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
  /** Owner's unit when it is not a taxonomy id ("sq ft", "day", "sofa"). Never a price. */
  unit_label?: string | null;
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

// "per"/"a" need a word boundary. A slash does not: "300 /kg" has no boundary before "/".
// "sq ft" is not "sq m". "per unit" is not the taxonomy id "item" (that one hides the unit).
const UNIT_WORDS: Array<[RegExp, string]> = [
  [/(?:\b(?:per|a)\s+|\/\s*)(kg|kilos?)\b/, "kg"],
  [/\b(?:per|a)\s+(hr|hours?)\b/, "hour"],
  [/\b(?:per|a)\s+(visits?)\b/, "visit"],
  [/\b(?:per|a)\s+(rooms?)\b/, "room"],
  [/(?:\b(?:per|a)\s+|\/\s*)(sqm|m2|m²|square metres?|square meters?|sq\s*m)\b/, "sqm"],
  [/\b(?:per|a)\s+(litre|liter|ltr)s?\b/, "litre"],
  [/\b(?:per|a)\s+(metres?|meters?|m)\b/, "metre"],
  [/\b(?:per|a)\s+(packs?|packets?|box|boxes)\b/, "pack"],
  [/\b(?:per|a)\s+(seats?|seaters?)\b/, "seat"],
  [/\b(?:per|a)\s+(jobs?)\b/, "job"],
  [/\b(each|pcs?|pieces?)\b/, "item"],
];

/** Words a generated label may drop. "per"/"a"/"to" are glue. "flat" means a fixed price. */
const PRICE_FILLER = ["ksh", "kes", "kshs", "sh", "shs", "flat", "only", "the", "per", "a", "an", "to"];

function cleanUnitLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s+per\s+.*$/, "");
  if (!s || s.length > 32 || !/^[a-z][a-z ]{0,31}$/.test(s)) return null;
  return s;
}

function matchUnitLabel(low: string): string | null {
  const m = low.match(/(?:\b(?:per|a)\s+|\/\s*)([a-z][a-z0-9]*(?:\s+(?!per\b)[a-z][a-z0-9]*){0,3})\b/);
  return cleanUnitLabel(m?.[1] ?? "");
}

/**
 * Read an old free-text price into typed fields. Never throws; anything it can't read
 * comes back as mode "ask" with no amounts so the owner is asked, not guessed for.
 */
export function parsePriceText(raw: unknown): Omit<StructuredPrice, "in_stock" | "confirmed" | "source"> {
  const text = String(raw ?? "").trim();
  const low = text.toLowerCase();
  const unit = UNIT_WORDS.find(([re]) => re.test(low))?.[1] ?? null;
  const unit_label = unit ? null : matchUnitLabel(low);
  const base = { mode: "ask" as PricingMode, amount_ksh: null, min_ksh: null, max_ksh: null, unit, unit_label, parsed_from: text || undefined };
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
  // "(min 3 hours)" is a duration, not a price floor. "minimum 500" still means from.
  const durationMin = /\bmin(?:imum)?\s+\d+\s*(?:hours?|hrs?|days?|months?|mins?|minutes?)\b/.test(low);
  const from = /\b(from|starting|kuanzia)\b/.test(low) || (/\bmin(?:imum)?\b/.test(low) && !durationMin);
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

function unitSuffix(p: { unit?: string | null; unit_label?: string | null }): string {
  if (p.unit && p.unit !== "item") return ` per ${labelOf(UNITS, p.unit) || p.unit}`;
  const note = cleanUnitLabel(p.unit_label);
  return note ? ` per ${note}` : "";
}

/** Display text derived from the typed price (what the prompt and old readers still see). */
export function priceLabel(p: Pick<StructuredPrice, "mode" | "amount_ksh" | "min_ksh" | "max_ksh" | "unit" | "unit_label">): string {
  const ksh = (n: number) => `KSh ${n.toLocaleString("en-US")}`;
  const per = unitSuffix(p);
  if (p.mode === "ask" || p.amount_ksh == null) return "Ask";
  if (p.mode === "range" && p.max_ksh != null) return `${ksh(p.min_ksh ?? p.amount_ksh)}-${p.max_ksh.toLocaleString("en-US")}${per}`;
  if (p.mode === "from") return `From ${ksh(p.amount_ksh)}${per}`;
  return `${ksh(p.amount_ksh)}${per}`;
}

/** Significant words of a price line. Numbers lose commas and k/m suffixes. Glue words drop. */
export function priceSigTokens(raw: string): string[] {
  const stripped = raw.toLowerCase().replace(/\/=/g, " ").replace(/(\d),(?=\d)/g, "$1");
  const out: string[] = [];
  for (const tok of stripped.split(/[^a-z0-9.]+/)) {
    if (!tok || tok === "." || PRICE_FILLER.includes(tok)) continue;
    const amount = /^\d/.test(tok) ? parseAmount(tok) : null;
    out.push(amount != null ? String(amount) : tok);
  }
  return out;
}

/** True when every significant word of `src` is already in `label`. */
export function priceTextCovers(label: string, src: string): boolean {
  const have = new Set(priceSigTokens(label));
  return priceSigTokens(src).every((tok) => have.has(tok));
}

/** Fill a missing taxonomy unit, or the owner's own unit phrase, from the text they wrote. */
export function withOwnerUnit<T extends Pick<StructuredPrice, "unit" | "unit_label">>(pricing: T, original: string): T {
  const src = original.trim();
  if (!src || pricing.unit) return pricing.unit ? { ...pricing, unit_label: null } : pricing;
  const parsed = parsePriceText(src);
  if (parsed.unit) return { ...pricing, unit: parsed.unit, unit_label: null };
  const note = parsed.unit_label || cleanUnitLabel(pricing.unit_label);
  return note ? { ...pricing, unit: null, unit_label: note } : pricing;
}

/**
 * Price line callers should hear. The generated label wins only when it still
 * says everything the owner wrote. "KSh 40 per sq ft" stays that. "KSh 3,000 flat"
 * may become "KSh 3,000". "depends on size" is never replaced with "Ask".
 */
export function spokenPrice(
  pricing: Pick<StructuredPrice, "mode" | "amount_ksh" | "min_ksh" | "max_ksh" | "unit" | "unit_label">,
  original?: string | null,
): string {
  const src = String(original ?? "").trim();
  const label = priceLabel(withOwnerUnit(pricing, src));
  if (!src || priceTextCovers(label, src)) return label;
  return src;
}

function sameMoney(a: Pick<StructuredPrice, "mode" | "amount_ksh" | "max_ksh">, b: Pick<StructuredPrice, "mode" | "amount_ksh" | "max_ksh">): boolean {
  return a.mode === b.mode && a.amount_ksh === b.amount_ksh && a.max_ksh === b.max_ksh;
}

/**
 * What Yes / Change stores. Yes keeps the owner's wording when the label would
 * drop a unit or a qualifier. A changed amount keeps the unit. A unit the owner
 * picked in the sheet replaces the old phrase.
 */
export function confirmPriceFields(args: {
  storedText: string;
  storedPricing: StructuredPrice | null;
  incoming: StructuredPrice;
}): { text: string; pricing: StructuredPrice } {
  const storedText = args.storedText.trim();
  const stored = args.storedPricing;
  const incoming = args.incoming;
  const sourceText = String(stored?.parsed_from || storedText).trim() || storedText;
  const seeded: StructuredPrice = {
    ...incoming,
    unit: incoming.unit || stored?.unit || null,
    unit_label: incoming.unit ? null : incoming.unit_label || stored?.unit_label || null,
  };
  const hydrated = withOwnerUnit(seeded, sourceText);
  const untouched = !!stored && sameMoney(stored, incoming) && (incoming.unit || null) === (stored.unit || null);
  if (untouched) {
    const text = spokenPrice(hydrated, sourceText);
    return {
      text,
      pricing: { ...hydrated, in_stock: incoming.in_stock, source: "owner", confirmed: true, parsed_from: (sourceText || text).slice(0, 120) },
    };
  }
  const next: StructuredPrice = (incoming.unit || null) === (stored?.unit || null)
    ? { ...hydrated, in_stock: incoming.in_stock, source: "owner", confirmed: true }
    : { ...incoming, unit_label: incoming.unit ? null : incoming.unit_label ?? null, source: "owner", confirmed: true };
  const text = priceLabel(next);
  return { text, pricing: { ...next, parsed_from: text.slice(0, 120) } };
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
  const unit_label = unit ? null : cleanUnitLabel(r.unit_label);
  return {
    mode: mode as PricingMode,
    amount_ksh: num(r.amount_ksh),
    min_ksh: num(r.min_ksh),
    max_ksh: num(r.max_ksh),
    unit,
    ...(unit_label ? { unit_label } : {}),
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
  return { ...parsed, unit, unit_label: unit ? null : parsed.unit_label ?? null, in_stock: stock, source: "owner", confirmed: readable && Boolean(t) };
}
