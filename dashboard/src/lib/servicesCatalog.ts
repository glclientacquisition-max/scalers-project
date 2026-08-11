export type ServiceItem = {
  name: string;
  price_range: string;
  notes: string;
  out_of_scope: string;
  /** yes | no | unknown | "" (unset) */
  in_stock: string;
  category: string;
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
      return {
        name: String(r.name || "").trim(),
        price_range: String(r.price_range || r.priceRange || "").trim(),
        notes: String(r.notes || "").trim(),
        out_of_scope: String(r.out_of_scope || r.outOfScope || "").trim(),
        in_stock: normalizeInStock(r.in_stock ?? r.inStock),
        category: String(r.category || "").trim(),
      };
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

  // Simple menu list: "Home cleaning - from 2,500 KES"
  const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    const name = dash[1].trim();
    const price = dash[2].trim();
    if (!name) return null;
    return {
      name,
      price_range: price,
      notes: "",
      out_of_scope: "",
      in_stock: "",
      category: "",
    };
  }

  // Name only
  return {
    name: cleaned,
    price_range: "",
    notes: "",
    out_of_scope: "",
    in_stock: "",
    category: "",
  };
}

/**
 * Parse a bulk paste block into service rows.
 *
 * Simple (preferred):
 *   Home cleaning - from 2,500 KES
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
