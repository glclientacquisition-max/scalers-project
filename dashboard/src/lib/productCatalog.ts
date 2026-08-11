export type ProductItem = {
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
      if (
        !item.name &&
        !item.sku &&
        !item.category &&
        !item.price &&
        !item.notes
      ) {
        return null;
      }
      return item;
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
    .replace(/[\s_-]+/g, "");
}

/**
 * Parse CSV / TSV / pipe product lists.
 * Header row optional. Recognized columns: name, price, category, in_stock, sku, unit, notes, aliases.
 */
export function parseProductCsv(raw: string): ProductItem[] {
  const text = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delim = lines[0].includes("\t")
    ? "\t"
    : lines[0].includes("|")
      ? "|"
      : ",";

  const splitLine = (line: string): string[] => {
    if (delim === ",") {
      // Simple CSV with quoted fields
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
        } else if (ch === "," && !inQ) {
          out.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out;
    }
    return line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
  };

  const first = splitLine(lines[0]).map(headerKey);
  const looksHeader = first.some((h) =>
    ["name", "title", "product", "item", "price", "category", "sku", "stock", "instock"].includes(
      h
    )
  );

  let keys = ["name", "price", "category", "in_stock", "sku", "unit", "notes", "aliases"];
  let start = 0;
  if (looksHeader) {
    keys = first.map((h) => {
      if (["name", "title", "product", "item", "book"].includes(h)) return "name";
      if (["price", "pricerange", "cost", "amount"].includes(h)) return "price";
      if (["category", "genre", "type", "section"].includes(h)) return "category";
      if (["instock", "stock", "availability", "available"].includes(h)) {
        return "in_stock";
      }
      if (["sku", "code", "id", "isbn"].includes(h)) return "sku";
      if (["unit", "pack"].includes(h)) return "unit";
      if (["notes", "description", "desc"].includes(h)) return "notes";
      if (["aliases", "alias", "aka"].includes(h)) return "aliases";
      return h;
    });
    start = 1;
  }

  const out: ProductItem[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = splitLine(lines[i]);
    if (!cols.some((c) => c)) continue;
    const row: Record<string, string> = {};
    keys.forEach((k, idx) => {
      if (k && cols[idx] != null) row[k] = cols[idx];
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

export function parseBulkProducts(raw: string): ProductItem[] {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  // Prefer CSV path when commas/tabs/pipes present with multiple columns
  if (/[,|\t]/.test(text) && text.includes("\n")) {
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

export function mergeProductCatalog(
  existing: ProductItem[],
  incoming: ProductItem[],
  mode: "merge" | "replace"
): ProductItem[] {
  if (mode === "replace") {
    return incoming.filter((p) => p.name.trim()).slice(0, PRODUCT_CATALOG_MAX);
  }
  const map = new Map<string, ProductItem>();
  for (const p of existing) {
    if (p.name.trim()) map.set(p.name.trim().toLowerCase(), p);
  }
  for (const p of incoming) {
    if (!p.name.trim()) continue;
    const k = p.name.trim().toLowerCase();
    if (!map.has(k)) map.set(k, p);
  }
  return [...map.values()].slice(0, PRODUCT_CATALOG_MAX);
}
