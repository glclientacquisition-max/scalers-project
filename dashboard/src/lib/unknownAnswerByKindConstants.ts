/** Keep in sync with src/conversation/unknownAnswerByKind.js DEFAULT_BY_KIND. */

export const FALLBACK_KINDS = ["general", "price", "hours", "fee", "pay"] as const;

export type FallbackKind = (typeof FALLBACK_KINDS)[number];

export type UnknownAnswerByKind = Partial<Record<FallbackKind, { en: string; sw: string }>>;

export const DEFAULT_BY_KIND: Record<FallbackKind, { en: string; sw: string }> = {
  general: {
    en: "Let me check with the team and get back to you.",
    sw: "Wacha niulize timu kisha nikujulishe.",
  },
  price: {
    en: "I'll note what you need and the shop will call you back with a price.",
    sw: "Nitaweka ombi lako na duka litakupigia kwa bei.",
  },
  hours: {
    en: "I'll confirm opening times with the team and call you back.",
    sw: "Nitahakikisha muda wa kufungua na timu kisha nitakupigia.",
  },
  fee: {
    en: "I'll check whether we deliver to your area and someone will call you back.",
    sw: "Nitaangalia kama tunafikisha eneo lako na mtu atakupigia.",
  },
  pay: {
    en: "I'll ask the team to call you back with the payment details.",
    sw: "Timu itakupigia simu kukupa maelezo ya malipo.",
  },
};

export const FALLBACK_KIND_LABELS: Record<FallbackKind, string> = {
  general: "General",
  price: "Prices and quotes",
  hours: "Opening hours",
  fee: "Delivery and areas",
  pay: "Payment and till",
};

export const UNKNOWN_ANSWER_BY_KIND_COLUMN = "unknown_answer_by_kind";

export function parseUnknownAnswerByKind(raw: unknown): UnknownAnswerByKind | null {
  let obj = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: UnknownAnswerByKind = {};
  for (const kind of FALLBACK_KINDS) {
    const row = (obj as Record<string, unknown>)[kind];
    if (!row || typeof row !== "object") continue;
    const en = String((row as { en?: string }).en || "").trim();
    const sw = String((row as { sw?: string }).sw || "").trim();
    if (en || sw) out[kind] = { en, sw };
  }
  return Object.keys(out).length ? out : null;
}

export function isQuoteStyleFallbackLine(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return (
    /\bcall you back with a (?:price|quote)\b/.test(t) ||
    /\bshop will call you back\b/.test(t) ||
    /\bnote what you need\b/.test(t) ||
    /\bduka litakupigia\b/.test(t) ||
    /\blitakupigia kwa bei\b/.test(t) ||
    /\bcannot quote\b/.test(t) ||
    /\bcan'?t quote\b/.test(t) ||
    /\bformal quote\b/.test(t)
  );
}

function generalFitsFallbackKind(line: string, kind: FallbackKind): boolean {
  if (!line) return false;
  if (isQuoteStyleFallbackLine(line)) return kind === "price";
  if (kind === "general") return true;
  return true;
}

function callbackSafeLine(text: string): boolean {
  const line = String(text || "").trim();
  if (!line || line.length > 240 || /[{}]/.test(line)) return false;
  return true;
}

/** Matches src/conversation/unknownAnswerByKind.js lineForKind() for Desk copy. */
export function spokenFallbackLine(
  kind: FallbackKind,
  byKind: UnknownAnswerByKind | null,
  lang: "en" | "sw",
  legacyGeneral?: string | null
): string {
  const custom = byKind?.[kind]?.[lang]?.trim();
  if (custom && callbackSafeLine(custom) && (kind === "price" || !isQuoteStyleFallbackLine(custom))) return custom;
  const fromJson = byKind?.general?.[lang]?.trim() || (lang === "en" ? byKind?.general?.en?.trim() : "");
  const legacy = lang === "en" ? String(legacyGeneral || "").trim() : "";
  const general = fromJson || legacy;
  if (general && generalFitsFallbackKind(general, kind) && callbackSafeLine(general)) return general;
  return DEFAULT_BY_KIND[kind][lang];
}

/** @deprecated Use spokenFallbackLine */
export function displayLine(
  kind: FallbackKind,
  byKind: UnknownAnswerByKind | null,
  lang: "en" | "sw",
  legacyGeneral?: string | null
): string {
  return spokenFallbackLine(kind, byKind, lang, legacyGeneral);
}
