import { isAskPriceWording } from "./catalogValidation";
import { parsePriceText, sanitizePricing, type StructuredPrice } from "./structuredData";
import { stableRowId } from "@/lib/factHash";

export type ServiceItem = {
  /** Stable, non-numeric id (svc_…). Assigned on save; field paths key on it. */
  id?: string;
  name: string;
  price_range: string;
  notes: string;
  out_of_scope: string;
  /** yes | no | unknown | "" (unset) */
  in_stock: string;
  category: string;
  /** fixed | from | range | ask, or another owner-set mode. */
  pricing_mode?: string;
  /** Required for a Home catalog row to count. Absent does not count. */
  site_visit_required?: boolean;
  /** owner | seed | import | inferred | call_suggested */
  /** Typed price (structuredData.ts). Text field stays for old readers. */
  pricing?: StructuredPrice;
  source?: string;
  status?: string;
};

export function emptyService(): ServiceItem {
  return {
    name: "",
    price_range: "",
    notes: "",
    out_of_scope: "",
    in_stock: "",
    category: "",
  };
}

function normalizeInStock(raw: unknown): string {
  const stockRaw = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (["yes", "true", "1", "in_stock", "available"].includes(stockRaw)) {
    return "yes";
  }
  if (
    ["no", "false", "0", "out", "out_of_stock", "unavailable"].includes(stockRaw)
  ) {
    return "no";
  }
  if (["unknown", "maybe", "?"].includes(stockRaw)) return "unknown";
  return "";
}

export function normalizeServicesCatalog(raw: unknown): ServiceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      const source = String(r.source || "").trim().toLowerCase();
      const status = String(r.status || "").trim().toLowerCase();
      const item: ServiceItem = {
        name: String(r.name || "").trim(),
        price_range: String(r.price_range || r.priceRange || "").trim(),
        notes: String(r.notes || "").trim(),
        out_of_scope: String(r.out_of_scope || r.outOfScope || "").trim(),
        in_stock: normalizeInStock(r.in_stock ?? r.inStock),
        category: String(r.category || "").trim(),
      };
      const id = stableRowId(r);
      if (id) item.id = id;
      const pricing = sanitizePricing(r.pricing);
      if (pricing) item.pricing = pricing;
      const mode = String(r.pricing_mode || r.pricingMode || "").trim();
      if (mode) item.pricing_mode = mode.slice(0, 40);
      const visit = r.site_visit_required ?? r.siteVisitRequired;
      const visitText = String(visit ?? "").trim().toLowerCase();
      if (visit === true || visitText === "true" || visitText === "yes") {
        item.site_visit_required = true;
      } else if (visit === false || visitText === "false" || visitText === "no") {
        item.site_visit_required = false;
      }
      if (
        source === "owner" ||
        source === "seed" ||
        source === "import" ||
        source === "inferred" ||
        source === "call_suggested"
      ) {
        item.source = source;
      }
      if (status === "golden" || status === "confirmed" || status === "suggested") {
        item.status = source === "seed" || source === "call_suggested" ? "suggested" : status;
      }
      return item;
    })
    .filter(
      (row) =>
        row.name ||
        row.price_range ||
        row.notes ||
        row.out_of_scope ||
        row.in_stock ||
        row.category
    );
}

export function parseServicesCatalogField(raw: FormDataEntryValue | null): ServiceItem[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    return normalizeServicesCatalog(JSON.parse(text)).filter((s) => s.name);
  } catch {
    return [];
  }
}

/** Text for tenants.services_offered + Gemini compiler. */
export function formatServicesForCompiler(
  services: ServiceItem[],
  extraNotes = ""
): string {
  const rows = services.filter((s) => s.name.trim());
  const lines = rows.map((s) => {
    const bits = [`- ${s.name.trim()}`];
    if (s.category.trim()) bits.push(`category ${s.category.trim()}`);
    if (s.price_range.trim()) bits.push(`price ${s.price_range.trim()}`);
    if (s.pricing_mode?.trim()) bits.push(`pricing ${s.pricing_mode.trim()}`);
    if (s.site_visit_required === true) bits.push("site visit required");
    else if (s.site_visit_required === false) bits.push("no site visit");
    if (s.in_stock.trim()) bits.push(`in stock ${s.in_stock.trim()}`);
    if (s.notes.trim()) bits.push(s.notes.trim());
    if (s.out_of_scope.trim()) bits.push(`out of scope: ${s.out_of_scope.trim()}`);
    return bits.join(" - ");
  });
  const catalog = lines.length ? `Services:\n${lines.join("\n")}` : "";
  const notes = extraNotes.trim();
  if (catalog && notes) return `${catalog}\n\nAdditional notes:\n${notes}`;
  return catalog || notes;
}

/** Pull free-text notes when migrating from old services_offered blobs. */
export function extractServicesNotes(servicesOffered: string): string {
  const text = String(servicesOffered || "").trim();
  if (!text) return "";
  const marker = text.match(/Additional notes:\s*([\s\S]+)$/i);
  if (marker?.[1]) return marker[1].trim();
  if (/^Services:\n/i.test(text)) return "";
  return text;
}

/**
 * A tail is a price when the catalogue price reader (parsePriceText) finds an
 * amount, or the words are an ask line ("depends on size", "price depends").
 * Typed units such as "sq ft" and "per day" stay in this text. Reading them
 * into unit_label is PR #771 (spokenPrice); this split does not copy that reader.
 */
function isPriceWording(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  const parsed = parsePriceText(text);
  if (parsed.mode === "fixed" || parsed.mode === "from" || parsed.mode === "range") return true;
  if (parsed.amount_ksh != null) return true;
  return isAskPriceWording(text);
}

/** Colon or comma only when the right side is a price, not "3,000" or "9:00". */
function splitMarkedPrice(line: string, mark: RegExp): { name: string; price: string } | null {
  const match = line.match(mark);
  if (!match) return null;
  const name = match[1].trim();
  const price = match[2].trim();
  if (!name || !/^(?:ksh|kes|from|starting|kuanzia|price|ask|call|varies|depends|tbd|quote|quotation|on request)\b/i.test(price)) {
    return null;
  }
  if (!isPriceWording(price)) return null;
  return { name, price };
}

function splitCurrencyPrice(line: string): { name: string; price: string } | null {
  const match = /\s+(?=(?:ksh|kes)\b)/i.exec(line);
  if (!match || match.index <= 0) return null;
  const name = line.slice(0, match.index).trim();
  const price = line.slice(match.index).trim();
  if (!name || /^(?:from|starting|kuanzia|base\s*\+|min(?:imum)?)$/i.test(name)) return null;
  if (!isPriceWording(price)) return null;
  return { name, price };
}

function splitAskPrice(line: string): { name: string; price: string } | null {
  const match = line.match(/^(.*?)\s+((?:price\s+)?depends\s+on\b.+)$/i);
  if (!match) return null;
  const name = match[1].trim();
  const price = match[2].trim();
  if (!name || !isPriceWording(price)) return null;
  return { name, price };
}

function serviceFromNamePrice(name: string, price: string): ServiceItem | null {
  if (!name.trim()) return null;
  return {
    name: name.trim(),
    price_range: price.trim(),
    notes: "",
    out_of_scope: "",
    in_stock: "",
    category: "",
  };
}

function parseBulkServiceLine(line: string): ServiceItem | null {
  const cleaned = line.replace(/^[-*•]\s*/, "").trim();
  if (!cleaned) return null;

  // Spreadsheet / advanced: name | price | notes | out of scope (unchanged)
  if (cleaned.includes("|")) {
    const parts = cleaned.split("|").map((p) => p.trim());
    const [name = "", price = "", notes = "", out = ""] = parts;
    if (!name) return null;
    return {
      name,
      price_range: price,
      notes,
      out_of_scope: out,
      in_stock: "",
      category: "",
    };
  }

  // Tab-separated (Excel / Sheets paste)
  if (cleaned.includes("\t")) {
    const parts = cleaned.split("\t").map((p) => p.trim());
    const [name = "", price = "", notes = "", out = ""] = parts;
    if (!name) return null;
    return {
      name,
      price_range: price,
      notes,
      out_of_scope: out,
      in_stock: "",
      category: "",
    };
  }

  // "Home cleaning - from 2,500 KES", "Name: KSh 60 per sq ft", "Name, KSh 60"
  const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    const row = serviceFromNamePrice(dash[1], dash[2]);
    if (row) return row;
  }
  const marked =
    splitMarkedPrice(cleaned, /^(.+?):\s+(.+)$/) ||
    splitMarkedPrice(cleaned, /^(.+?),\s+(.+)$/);
  if (marked) {
    const row = serviceFromNamePrice(marked.name, marked.price);
    if (row) return row;
  }
  const currency = splitCurrencyPrice(cleaned);
  if (currency) {
    const row = serviceFromNamePrice(currency.name, currency.price);
    if (row) return row;
  }
  const ask = splitAskPrice(cleaned);
  if (ask) {
    const row = serviceFromNamePrice(ask.name, ask.price);
    if (row) return row;
  }

  // Name only
  return serviceFromNamePrice(cleaned, "");
}

/**
 * Parse a bulk paste block into service rows.
 *
 * Simple (preferred):
 *   Home cleaning - from 2,500 KES
 *   Window cleaning KSh 60 per sq ft
 *   Deep clean price depends on size
 *   Plumbing
 *
 * Advanced (unchanged):
 *   name | price | notes | out of scope
 * Also accepts tab-separated columns.
 */
export function parseBulkServices(raw: string): ServiceItem[] {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^services?\s*:?$/i.test(line))
    .map(parseBulkServiceLine)
    .filter((row): row is ServiceItem => Boolean(row?.name));
}
