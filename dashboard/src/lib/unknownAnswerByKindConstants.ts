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
    en: "I'll send payment details on WhatsApp after this call.",
    sw: "Nitakutumia maelezo ya malipo kwa WhatsApp baada ya simu hii.",
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

export function displayLine(kind: FallbackKind, byKind: UnknownAnswerByKind | null, lang: "en" | "sw"): string {
  const custom = byKind?.[kind]?.[lang]?.trim();
  if (custom) return custom;
  return DEFAULT_BY_KIND[kind][lang];
}
