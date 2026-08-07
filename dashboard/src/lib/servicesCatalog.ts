export type ServiceItem = {
  name: string;
  price_range: string;
  notes: string;
  out_of_scope: string;
};

export function emptyService(): ServiceItem {
  return { name: "", price_range: "", notes: "", out_of_scope: "" };
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
      };
    })
    .filter((row) => row.name || row.price_range || row.notes || row.out_of_scope);
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
    if (s.price_range.trim()) bits.push(`price ${s.price_range.trim()}`);
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
