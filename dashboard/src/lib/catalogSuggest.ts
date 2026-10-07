import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";

export type CatalogSuggestConfidence = "rule" | "weak";

export type CatalogSuggestMeta = {
  confidence: CatalogSuggestConfidence;
  /** True when name, price fields, modes, or aliases changed from input. */
  changed: boolean;
};

const QUOTE_TAIL =
  /\s*[-–—]\s*(quotation|quote|quoted|pricing|price on (site|visit)|poa|tbc|tbd)\s*$/i;

const FROM_PRICE_TAIL = /\s*[-–—]\s*(from\s+.+|starting\s+at\s+.+)$/i;

const PG_SHORT = /^(\d+)\s*pg(?:\s+(.+))?$/i;

function uniqAliases(base: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...base, ...extra]) {
    const a = String(raw || "").trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= 8) break;
  }
  return out;
}

function trimNameNoise(name: string): string {
  return name
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
    .trim();
}

function expandPgName(rawName: string): { name: string; aliases: string[] } {
  const trimmed = trimNameNoise(rawName);
  const m = trimmed.match(PG_SHORT);
  if (!m) return { name: trimmed, aliases: [] };
  const pages = m[1];
  const rest = String(m[2] || "").trim();
  const alias = trimmed;
  const expandedRest = rest
    .replace(/\bexe\b/gi, "exercise")
    .replace(/\bwk\b/gi, "workbook")
    .trim();
  const name = expandedRest
    ? `${pages} page ${expandedRest}`.replace(/\s{2,}/g, " ")
    : `${pages} page book`;
  return { name: trimNameNoise(name), aliases: [alias] };
}

function splitServiceLine(name: string, priceRange: string): {
  name: string;
  price_range: string;
  pricing_mode?: string;
  notes?: string;
} {
  let nextName = trimNameNoise(name);
  let nextPrice = String(priceRange || "").trim();
  let pricing_mode: string | undefined;
  let notes: string | undefined;

  const fromMatch = nextName.match(FROM_PRICE_TAIL);
  if (fromMatch) {
    nextName = trimNameNoise(nextName.slice(0, fromMatch.index));
    if (!nextPrice) nextPrice = fromMatch[1].replace(/^from\s+/i, "from ").trim();
    pricing_mode = "from";
  }

  if (QUOTE_TAIL.test(nextName)) {
    nextName = trimNameNoise(nextName.replace(QUOTE_TAIL, ""));
    pricing_mode = pricing_mode || "ask";
    notes = notes || "Quote on request";
  }

  if (/^(quote|quotation|poa|tbc|tbd)$/i.test(nextPrice)) {
    nextPrice = "";
    pricing_mode = "ask";
  }

  return { name: nextName, price_range: nextPrice, pricing_mode, notes };
}

export function suggestServiceRow(
  row: ServiceItem,
  vertical?: string | null
): ServiceItem & CatalogSuggestMeta {
  void vertical;
  const baseName = String(row.name || "").trim();
  if (!baseName) {
    return { ...row, confidence: "weak", changed: false };
  }

  const split = splitServiceLine(baseName, row.price_range);
  const pg = expandPgName(split.name);
  const name = pg.name || split.name;
  const alsoKnown =
    pg.aliases.length > 0
      ? pg.aliases[0]
      : baseName !== name
        ? baseName
        : "";

  const noteParts = [split.notes, row.notes].filter(Boolean);
  if (alsoKnown && !String(row.notes || "").includes(alsoKnown)) {
    noteParts.unshift(`Also: ${alsoKnown}`);
  }
  const notes = noteParts.join(" ").trim() || row.notes;

  const next: ServiceItem = {
    ...row,
    name,
    price_range: split.price_range || row.price_range,
    notes: notes || row.notes,
  };
  if (split.pricing_mode) next.pricing_mode = split.pricing_mode;

  const changed =
    name !== baseName ||
    (split.price_range || "") !== String(row.price_range || "").trim() ||
    Boolean(split.pricing_mode && split.pricing_mode !== row.pricing_mode) ||
    notes !== String(row.notes || "").trim();

  return {
    ...next,
    source: row.source === "owner" ? "owner" : row.source || "import",
    confidence: pg.aliases.length || split.pricing_mode ? "rule" : changed ? "weak" : "weak",
    changed,
  };
}

export function suggestProductRow(row: ProductItem): ProductItem & CatalogSuggestMeta {
  const baseName = String(row.name || "").trim();
  if (!baseName) {
    return { ...row, confidence: "weak", changed: false };
  }

  let name = baseName;
  let price = String(row.price || "").trim();
  let price_mode = row.price_mode;
  const extraAliases: string[] = [];

  const fromMatch = name.match(FROM_PRICE_TAIL);
  if (fromMatch) {
    name = trimNameNoise(name.slice(0, fromMatch.index));
    if (!price) price = fromMatch[1].replace(/^from\s+/i, "from ").trim();
    price_mode = price_mode || "from";
  }

  if (QUOTE_TAIL.test(name)) {
    name = trimNameNoise(name.replace(QUOTE_TAIL, ""));
    price_mode = price_mode || "ask";
  }

  const pg = expandPgName(name);
  if (pg.aliases.length) {
    extraAliases.push(...pg.aliases);
    name = pg.name;
  }

  const aliases = uniqAliases(row.aliases, extraAliases.concat(baseName !== name ? [baseName] : []));

  const next: ProductItem = {
    ...row,
    name: trimNameNoise(name),
    price: price || row.price,
    aliases,
  };
  if (price_mode) next.price_mode = price_mode;

  const changed =
    next.name !== baseName ||
    (price || "") !== String(row.price || "").trim() ||
    Boolean(price_mode && price_mode !== row.price_mode) ||
    aliases.join("|") !== row.aliases.join("|");

  return {
    ...next,
    source: row.source === "owner" ? "owner" : row.source || "import",
    confidence: pg.aliases.length || price_mode ? "rule" : changed ? "weak" : "weak",
    changed,
  };
}

export function suggestImportedServices(
  rows: ServiceItem[],
  vertical?: string | null
): ServiceItem[] {
  return rows.map((row) => {
    const suggested = suggestServiceRow(row, vertical);
    const { confidence: _c, changed: _ch, ...item } = suggested;
    void _c;
    void _ch;
    return item;
  });
}

export function suggestImportedProducts(rows: ProductItem[]): ProductItem[] {
  return rows.map((row) => {
    const suggested = suggestProductRow(row);
    const { confidence: _c, changed: _ch, ...item } = suggested;
    void _c;
    void _ch;
    return item;
  });
}

/** Preview rows keep suggest meta for UI. */
export function previewSuggestedServices(
  rows: ServiceItem[],
  vertical?: string | null
): (ServiceItem & CatalogSuggestMeta)[] {
  return rows.map((row) => suggestServiceRow(row, vertical));
}

export function previewSuggestedProducts(rows: ProductItem[]): (ProductItem & CatalogSuggestMeta)[] {
  return rows.map((row) => suggestProductRow(row));
}
