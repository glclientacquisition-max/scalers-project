export type PriceMode = "fixed" | "from" | "range" | "ask";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type CaptureHours = {
  timezone: "Africa/Nairobi";
  location: string;
  days: Record<DayKey, { open: string; close: string } | null>;
};

const PRICE_MODES: PriceMode[] = ["fixed", "from", "range", "ask"];

const DAY_ALIASES: Record<string, DayKey> = {
  mon: "mon",
  monday: "mon",
  tue: "tue",
  tues: "tue",
  tuesday: "tue",
  wed: "wed",
  wednesday: "wed",
  thu: "thu",
  thur: "thu",
  thurs: "thu",
  thursday: "thu",
  fri: "fri",
  friday: "fri",
  sat: "sat",
  saturday: "sat",
  sun: "sun",
  sunday: "sun",
};

const DAY_RE =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)\b/gi;

const TIME_RE =
  /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i;

export type CaptureProduct = {
  name?: string | null;
  category?: string | null;
  price?: string | null;
  price_mode?: string | null;
};

export type CaptureService = {
  name?: string | null;
  pricing_mode?: string | null;
  price?: string | null;
  site_visit_required?: boolean | null;
};

function asMode(raw: string | null | undefined): PriceMode | null {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  return PRICE_MODES.find((mode) => mode === key) ?? null;
}

/** Explicit mode, or a price string that names a real way to charge. */
export function inferPriceMode(price: string | null | undefined): PriceMode | null {
  const explicit = asMode(price);
  if (explicit) return explicit;
  const raw = String(price || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (/\b(ask|on request|quoted)\b/.test(lower) && !/\d/.test(lower)) return "ask";
  if (/^from\b/.test(lower) && /\d/.test(lower)) return "from";
  if (/\d/.test(lower) && /(?:\bto\b|[-–—])/.test(lower)) return "range";
  if (/\d/.test(lower) || /\b(ksh|kes)\b/.test(lower)) return "fixed";
  return null;
}

function productMode(product: CaptureProduct): PriceMode | null {
  return asMode(product.price_mode) || inferPriceMode(product.price);
}

export function shopCatalogPasses(products: CaptureProduct[]): boolean {
  const priced = products.filter((product) => {
    return Boolean(String(product.name || "").trim()) && productMode(product) != null;
  });
  if (priced.length >= 10) return true;
  const categories = new Set(
    priced
      .map((product) => String(product.category || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return categories.size >= 3;
}

export function homeCatalogPasses(services: CaptureService[]): boolean {
  const ready = services.filter((service) => {
    const name = String(service.name || "").trim();
    const mode = String(service.pricing_mode || "").trim();
    const visit = service.site_visit_required;
    return Boolean(name) && Boolean(mode) && (visit === true || visit === false);
  });
  return ready.length >= 3;
}

function meridiem(raw: string | undefined): "am" | "pm" | null {
  if (!raw) return null;
  return raw.toLowerCase().startsWith("a") ? "am" : "pm";
}

function clockHour(hour: number, mer: "am" | "pm" | null): number | null {
  if (hour > 23 || hour < 0) return null;
  if (mer && hour > 12) return null;
  if (mer === "am") return hour === 12 ? 0 : hour;
  if (mer === "pm") return hour < 12 ? hour + 12 : hour;
  return hour;
}

function hhmm(hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59 || minute < 0 || hour < 0) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Loose hours capture. "Mon-Sat 8-7" and "Mon–Sat 8–7" pass.
 * A bare "8-7" with no day does not. Close at or before open, with no am/pm, is evening.
 */
export function parseCaptureHours(text: string): CaptureHours | null {
  const normalized = String(text || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const days: Array<{ key: DayKey; start: number; end: number }> = [];
  for (const match of normalized.matchAll(DAY_RE)) {
    const key = DAY_ALIASES[match[1].toLowerCase()];
    if (!key || match.index == null) continue;
    days.push({ key, start: match.index, end: match.index + match[0].length });
  }
  if (!days.length) return null;

  let openDays: DayKey[];
  if (days.length >= 2) {
    const between = normalized.slice(days[0].end, days[1].start);
    if (/^(?:\s*-\s*|\s+to\s+)$/i.test(between)) {
      const from = DAY_ORDER.indexOf(days[0].key);
      const to = DAY_ORDER.indexOf(days[1].key);
      if (to < from) return null;
      openDays = DAY_ORDER.slice(from, to + 1);
    } else {
      openDays = [...new Set(days.map((day) => day.key))];
    }
  } else {
    openDays = [days[0].key];
  }
  if (!openDays.length) return null;

  const time = normalized.match(TIME_RE);
  if (!time) return null;
  const openHour = Number(time[1]);
  const openMinute = Number(time[2] || "0");
  const closeHourRaw = Number(time[4]);
  const closeMinute = Number(time[5] || "0");
  const openMer = meridiem(time[3]);
  const closeMer = meridiem(time[6]);
  const openH = clockHour(openHour, openMer);
  let closeH = clockHour(closeHourRaw, closeMer);
  if (openH == null || closeH == null) return null;

  if (!openMer && !closeMer && closeH * 60 + closeMinute <= openH * 60 + openMinute) {
    if (closeH < 12) closeH += 12;
  } else if (openMer === "am" && !closeMer && closeH < 12 && closeH <= openH) {
    closeH += 12;
  }

  const open = hhmm(openH, openMinute);
  const close = hhmm(closeH, closeMinute);
  if (!open || !close || open >= close) return null;

  const openSet = new Set(openDays);
  const scheduleDays = {} as Record<DayKey, { open: string; close: string } | null>;
  for (const key of DAY_ORDER) {
    scheduleDays[key] = openSet.has(key) ? { open, close } : null;
  }

  return {
    timezone: "Africa/Nairobi",
    location: "",
    days: scheduleDays,
  };
}

export function hoursCapturePasses(
  text: string,
  schedule?: CaptureHours | null
): boolean {
  if (schedule && DAY_ORDER.some((key) => Boolean(schedule.days[key]?.open))) {
    return true;
  }
  return parseCaptureHours(text) != null;
}
