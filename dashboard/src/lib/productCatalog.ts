import { hydrateCatalogPriceFields } from "./catalogPricingMode";
import { sanitizePricing, type StructuredPrice } from "./structuredData";
import { stableRowId } from "./factHash";
export type ProductItem = {
  /** Stable, non-numeric id (prd_…). Assigned on save so a rename keeps its price. */
  id?: string;
  name: string;
  sku: string;
  category: string;
  /** Display price / range text (e.g. "2,500 KES") */
  price: string;
  unit: string;
  /** yes | no | unknown | "" */
  in_stock: string;
  notes: string;
  /** Alternate spoken names / spellings */
  aliases: string[];
  /** fixed | from | range | quote. Omitted until the owner or import sets it. */
  price_mode?: string;
  price_max?: number | null;
  /** Owner confirmed this row can be held. */
  holdable?: boolean;
  /** owner | seed | import | inferred | call_suggested */
  /** Typed price (structuredData.ts). Text field stays for old readers. */
  pricing?: StructuredPrice;
  source?: "owner" | "seed" | "import" | "inferred" | "call_suggested";
};

export const PRODUCT_CATALOG_MAX = 500;
/** Soft cap injected into live prompts to protect latency. */
export const PRODUCT_LIVE_INJECT_MAX = 100;

export function emptyProduct(): ProductItem {
  return {
    name: "",
    sku: "",
    category: "",
    price: "",
    unit: "",
    in_stock: "",
    notes: "",
    aliases: [],
  };
}

function normalizeInStock(raw: unknown): string {
  const stockRaw = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["yes", "y", "true", "1", "in_stock", "instock", "available", "ndiyo"].includes(stockRaw)) {
    return "yes";
  }
  if (
    ["no", "n", "false", "0", "out", "out_of_stock", "unavailable", "sold_out", "hapana"].includes(stockRaw)
  ) {
    return "no";
  }
  if (["unknown", "maybe", "?"].includes(stockRaw)) return "unknown";
  return "";
}

function normalizeAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((a) => String(a || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  return text
    .split(/[,;|]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function normalizeProductCatalog(raw: unknown): ProductItem[] {
  if (!raw) return [];
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const item: ProductItem = {
        name: String(r.name || "").trim().slice(0, 120),
        sku: String(r.sku || r.SKU || "").trim().slice(0, 64),
        category: String(r.category || "").trim().slice(0, 80),
        price: String(r.price || r.price_range || r.priceRange || "")
          .trim()
          .slice(0, 80),
        unit: String(r.unit || "").trim().slice(0, 40),
        in_stock: normalizeInStock(r.in_stock ?? r.inStock),
        notes: String(r.notes || "").trim().slice(0, 240),
        aliases: normalizeAliases(r.aliases ?? r.alias),
      };
      const priceMode = String(r.price_mode || r.priceMode || "")
        .trim()
        .toLowerCase();
      if (
        priceMode === "fixed" ||
        priceMode === "from" ||
        priceMode === "range" ||
        priceMode === "ask" ||
        priceMode === "quote"
      ) {
        item.price_mode = priceMode === "ask" ? "quote" : priceMode;
      }
      const pmax = r.price_max ?? r.priceMax;
      if (pmax !== undefined && pmax !== null && pmax !== "") item.price_max = Number(pmax);
      const source = String(r.source || "").trim().toLowerCase();
      if (
        source === "owner" ||
        source === "seed" ||
        source === "import" ||
        source === "inferred" ||
        source === "call_suggested"
      ) {
        item.source = source;
      }
      const pricing = sanitizePricing(r.pricing);
      if (pricing) item.pricing = pricing;
      const id = stableRowId(r);
      if (id) item.id = id;
      // Absent holdable stays unset. Do not default it to false.
      const holdRaw = r.holdable;
      const holdText = String(holdRaw ?? "").trim().toLowerCase();
      if (holdRaw === true || holdText === "true" || holdText === "yes" || holdText === "1") {
        item.holdable = true;
      } else if (holdRaw === false || holdText === "false" || holdText === "no" || holdText === "0") {
        item.holdable = false;
      }
      if (
        !item.name &&
        !item.sku &&
        !item.category &&
        !item.price &&
        !item.notes
      ) {
        return null;
      }
      return hydrateCatalogPriceFields(item);
    })
    .filter((x): x is ProductItem => Boolean(x))
    .slice(0, PRODUCT_CATALOG_MAX);
}

export function parseProductCatalogField(
  raw: FormDataEntryValue | null
): ProductItem[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    return normalizeProductCatalog(JSON.parse(text)).filter((p) => p.name);
  } catch {
    return [];
  }
}

export function formatProductsForCompiler(products: ProductItem[]): string {
  const rows = products.filter((p) => p.name.trim()).slice(0, PRODUCT_LIVE_INJECT_MAX);
  if (!rows.length) return "";
  const lines = rows.map((p) => {
    const bits = [`- ${p.name.trim()}`];
    if (p.category.trim()) bits.push(`category ${p.category.trim()}`);
    if (p.sku.trim()) bits.push(`sku ${p.sku.trim()}`);
    if (p.price.trim()) bits.push(`price ${p.price.trim()}`);
    if (p.price_mode?.trim()) bits.push(`price mode ${p.price_mode.trim()}`);
    if (p.holdable === true) bits.push("can be held");
    if (p.unit.trim()) bits.push(`unit ${p.unit.trim()}`);
    if (p.in_stock.trim()) bits.push(`in stock ${p.in_stock.trim()}`);
    if (p.aliases.length) bits.push(`also called ${p.aliases.join(", ")}`);
    if (p.notes.trim()) bits.push(p.notes.trim());
    return bits.join(" - ");
  });
  const more =
    products.filter((p) => p.name.trim()).length > rows.length
      ? `\n(…and ${
          products.filter((p) => p.name.trim()).length - rows.length
        } more products on file — ask for the title and check or log an enquiry)`
      : "";
  return `Product catalogue:\n${lines.join("\n")}${more}`;
}

function headerKey(h: string): string {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\((?:kes|ksh|kshs|sh|shs|y\/n|yes\/no)\)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Column a header names, forgiving of "Product Name", "Price (KES)", "In stock (Y/N)". */
function columnFor(h: string): string {
  const k = headerKey(h);
  if (!k) return "";
  if (["name", "title", "product", "item", "book", "productname", "itemname", "producttitle", "bookname", "booktitle", "description1"].includes(k)) return "name";
  if (/^(?:price|pricerange|cost|amount|bei|sellingprice|unitprice|retailprice)(?:kes|ksh|kshs)?$/.test(k)) return "price";
  if (["category", "genre", "type", "section", "group"].includes(k)) return "category";
  if (["instock", "stock", "availability", "available", "yn", "yesno", "instockyn", "instockyesno"].includes(k)) return "in_stock";
  if (["sku", "code", "id", "isbn", "barcode", "itemcode", "productcode"].includes(k)) return "sku";
  if (["unit", "pack", "size"].includes(k)) return "unit";
  if (["notes", "note", "description", "desc", "details"].includes(k)) return "notes";
  if (["aliases", "alias", "aka", "othernames"].includes(k)) return "aliases";
  return "";
}

function detectDelimiter(lines: string[]): string {
  const head = lines[0];
  if (head.includes("\t")) return "\t";
  if (head.includes("|")) return "|";
  // Semicolon files (Excel in many locales) also use commas inside prices.
  const semis = (l: string) => (l.match(/;/g) || []).length;
  if (semis(head) > 0) {
    const sample = lines.slice(0, 20);
    const steady = sample.filter((l) => semis(l) === semis(head)).length;
    if (steady >= Math.ceil(sample.length * 0.8)) return ";";
  }
  return ",";
}

function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (ch === delim && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Unquoted "2,500" in a comma file splits into "2" and "500". Join it back only when it
 * is unambiguous: the row has exactly that many extra cells, and they are 3-digit groups
 * right after a 1–3 digit price.
 */
function joinThousands(cols: string[], expected: number, priceIdx: number): string[] {
  const extra = cols.length - expected;
  if (extra <= 0 || priceIdx < 0 || priceIdx >= cols.length) return cols;
  const lead = cols[priceIdx].replace(/^(?:kes|ksh|kshs|sh)\.?\s*/i, "");
  if (!/^\d{1,3}$/.test(lead)) return cols;
  const groups = cols.slice(priceIdx + 1, priceIdx + 1 + extra);
  if (groups.length !== extra) return cols;
  const lastOk = (g: string, last: boolean) => (last ? /^\d{3}(?:\.\d{1,2})?(?:\s*(?:kes|ksh|\/=|\/-))?$/i : /^\d{3}$/).test(g);
  if (!groups.every((g, i) => lastOk(g, i === groups.length - 1))) return cols;
  const joined = [cols[priceIdx], ...groups].join(",");
  return [...cols.slice(0, priceIdx), joined, ...cols.slice(priceIdx + 1 + extra)];
}

function mostCommon(nums: number[]): number {
  const counts = new Map<number, number>();
  for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
  let best = nums[0] ?? 0;
  for (const [n, c] of counts) if (c > (counts.get(best) || 0) || (c === counts.get(best) && n < best)) best = n;
  return best;
}

/**
 * Parse CSV / TSV / pipe / semicolon product lists.
 * Header row optional. Recognized columns: name, price, category, in_stock, sku, unit, notes, aliases,
 * with common spellings ("Product Name", "Price (KES)", "In stock", "Y/N").
 */
export function parseProductCsv(raw: string): ProductItem[] {
  const text = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delim = detectDelimiter(lines);
  const splitLine = (line: string): string[] =>
    delim === "|" || delim === "\t"
      ? line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""))
      : splitDelimited(line, delim);

  const headerCells = splitLine(lines[0]);
  const mapped = headerCells.map(columnFor);
  const looksHeader = mapped.includes("name") || mapped.filter(Boolean).length >= 2;

  let keys = ["name", "price", "category", "in_stock", "sku", "unit", "notes", "aliases"];
  let start = 0;
  if (looksHeader) {
    // First column wins when two headers map to the same field.
    const seen = new Set<string>();
    keys = mapped.map((k) => {
      if (!k || seen.has(k)) return "";
      seen.add(k);
      return k;
    });
    if (!seen.has("name")) {
      const firstFree = keys.findIndex((k) => !k);
      if (firstFree >= 0) keys[firstFree] = "name";
    }
    start = 1;
  }

  const body = lines.slice(start).map(splitLine);
  const expected = looksHeader ? headerCells.length : mostCommon(body.map((c) => c.length));
  const priceIdx = looksHeader ? keys.indexOf("price") : 1;

  const out: ProductItem[] = [];
  for (const rawCols of body) {
    if (!rawCols.some((c) => c)) continue;
    const cols = delim === "," ? joinThousands(rawCols, expected, priceIdx) : rawCols;
    const row: Record<string, string> = {};
    keys.forEach((k, idx) => {
      if (k && cols[idx] != null && cols[idx] !== "") row[k] = cols[idx];
    });
    // Fallback: first column = name, second = price
    if (!row.name && cols[0]) row.name = cols[0];
    if (!row.price && cols[1] && !looksHeader) row.price = cols[1];

    const item = normalizeProductCatalog([row])[0];
    if (item?.name) out.push(item);
    if (out.length >= PRODUCT_CATALOG_MAX) break;
  }
  return out;
}

/** Short per-row notes for the import preview. Empty when the row looks fine. */
export function productImportWarnings(item: Pick<ProductItem, "name" | "price">): string[] {
  const out: string[] = [];
  const price = String(item.price || "").trim();
  if (!price) out.push("No price");
  else if (!/\d/.test(price) && !/\b(?:ask|call|quote|free|varies)\b/i.test(price)) out.push("Check the price");
  return out;
}

/** True when the text reads as a delimited table rather than loose lines. */
function looksDelimitedTable(text: string): boolean {
  if (!text.includes("\n")) return false;
  if (/[,|\t]/.test(text)) return true;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && detectDelimiter(lines) === ";";
}

export function parseBulkProducts(raw: string): ProductItem[] {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  // Prefer the table path when commas/tabs/pipes (or steady semicolons) mark columns.
  if (looksDelimitedTable(text)) {
    return parseProductCsv(text);
  }
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line && !/^products?\s*:?$/i.test(line))
    .map((line) => {
      const dash = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (dash) {
        return {
          ...emptyProduct(),
          name: dash[1].trim(),
          price: dash[2].trim(),
        };
      }
      return { ...emptyProduct(), name: line };
    })
    .filter((p) => p.name)
    .slice(0, PRODUCT_CATALOG_MAX);
}

const nameKey = (p: ProductItem) => p.name.trim().toLowerCase();

/**
 * merge: add new names, keep existing rows as they are.
 * update: existing names (case-insensitive) take the incoming price (and stock when given);
 *         new names are added. Nothing is removed.
 * replace: the incoming list only.
 */
export function mergeProductCatalog(
  existing: ProductItem[],
  incoming: ProductItem[],
  mode: "merge" | "update" | "replace"
): ProductItem[] {
  if (mode === "replace") {
    return incoming.filter((p) => p.name.trim()).slice(0, PRODUCT_CATALOG_MAX);
  }
  const map = new Map<string, ProductItem>();
  for (const p of existing) {
    if (p.name.trim()) map.set(nameKey(p), p);
  }
  for (const p of incoming) {
    if (!p.name.trim()) continue;
    const k = nameKey(p);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, p);
      continue;
    }
    if (mode !== "update" || !p.price.trim()) continue;
    const next: ProductItem = { ...prev, price: p.price };
    if (p.price_mode) next.price_mode = p.price_mode;
    else delete next.price_mode;
    if (p.pricing) next.pricing = p.pricing;
    else delete next.pricing;
    if (p.in_stock) next.in_stock = p.in_stock;
    if (p.source) next.source = p.source;
    map.set(k, next);
  }
  return [...map.values()].slice(0, PRODUCT_CATALOG_MAX);
}
