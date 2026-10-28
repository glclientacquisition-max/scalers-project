/**
 * v2 Knowledge Base, Desk side (pure; no server imports).
 * The call reads compiled snapshots (Voice src/knowledge/kb). Desk edits kb_items, mirrors today's catalogue
 * columns so older readers stay right, then asks Voice to compile. "What callers hear" lines come from the
 * snapshot (doc.preview), written by the same rules the call uses, so there is no second copy of them here.
 */
export type KbKind = "service" | "product" | "package";
export type KbPriceMode = "fixed" | "range" | "from" | "per_unit" | "quote" | "free" | "none";
export type KbSwState = "none" | "suggested" | "approved" | "edited" | "rejected";

export type KbItem = {
  id: string;
  kind: KbKind;
  name_en: string;
  name_sw: string | null;
  name_sw_state: KbSwState;
  name_sw_suggested: string | null;
  aliases: string[];
  category_id: string | null;
  description_en: string | null;
  unit: string | null;
  price_mode: KbPriceMode;
  price_amount: number | null;
  price_min: number | null;
  price_max: number | null;
  in_stock: boolean | null;
  popular: boolean;
  delivery_fee_kes: number | null;
  status: "active" | "hidden";
  sort: number;
  source: string;
  legacy_ref: string | null;
  row_version: number;
};

export type KbCategory = { id: string; name_en: string; name_sw: string | null; name_sw_state: KbSwState; sort: number };
export type KbIssue = { code: string; severity: "block" | "warn" | "info"; item_id?: string; detail?: string };
export type KbPreview = { asked: string; en: string | null; sw: string | null };
export type KbSnapshotRow = { version: number; status: "live" | "failed" | "superseded"; issues: KbIssue[]; item_count: number; compiled_at: string; doc?: { preview?: KbPreview[] } | null };
export type KbCheck = { id: string; ok: boolean; detail?: string | null; fix?: string | null };
export type KbReadiness = { snapshot_version: number | null; passed: boolean; checks: KbCheck[]; tests: { name: string; ok: boolean; asked?: string | null; heard?: string | null; why?: string | null; ms?: number | null; kind?: string }[]; checked_at: string } | null;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function fmtKsh(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Same wording as Voice items.displayPrice. */
export function displayPrice(it: Pick<KbItem, "price_mode" | "price_amount" | "price_min" | "price_max">): string | null {
  switch (it.price_mode) {
    case "fixed":
    case "per_unit":
      return it.price_amount != null ? `KSh ${fmtKsh(it.price_amount)}` : null;
    case "range":
      return it.price_min != null && it.price_max != null ? `KSh ${fmtKsh(it.price_min)}–${fmtKsh(it.price_max)}` : null;
    case "from":
      return it.price_amount != null ? `From KSh ${fmtKsh(it.price_amount)}` : null;
    case "quote":
      return "Custom quote";
    case "free":
      return "Free";
    default:
      return null;
  }
}

export function slug(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function newItemId(kind: KbKind): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${kind === "product" ? "prd" : "svc"}_${r}`;
}

export type KbDraft = {
  id?: string;
  kind: KbKind;
  name_en: string;
  category: string;
  price_mode: KbPriceMode;
  price_amount: string;
  price_min: string;
  price_max: string;
  unit: string;
  aliases: string;
  description_en: string;
  popular: boolean;
  in_stock: boolean | null;
  row_version?: number;
};

/** Plain checks before a save. Messages are owner words. */
export function draftErrors(d: KbDraft): string[] {
  const out: string[] = [];
  if (!d.name_en.trim()) out.push("Add a name.");
  if (d.name_en.trim().length > 120) out.push("Keep the name under 120 letters.");
  if (["fixed", "per_unit", "from"].includes(d.price_mode) && num(d.price_amount) == null) out.push("Add the price.");
  if (d.price_mode === "range") {
    const lo = num(d.price_min);
    const hi = num(d.price_max);
    if (lo == null || hi == null) out.push("Add the lowest and highest price.");
    else if (lo > hi) out.push("The lowest price is above the highest.");
  }
  return out;
}

export function itemFromDraft(d: KbDraft, prev: KbItem | null, categoryId: string | null): KbItem {
  const mode = d.price_mode;
  const amount = ["fixed", "per_unit", "from"].includes(mode) ? num(d.price_amount) : mode === "free" ? 0 : null;
  return {
    id: prev?.id || d.id || newItemId(d.kind),
    kind: d.kind,
    name_en: d.name_en.trim(),
    name_sw: prev?.name_sw ?? null,
    name_sw_state: prev && prev.name_en.trim().toLowerCase() !== d.name_en.trim().toLowerCase() && prev.name_sw_state !== "edited" ? "none" : prev?.name_sw_state ?? "none",
    name_sw_suggested: prev?.name_sw_suggested ?? null,
    aliases: d.aliases.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 12),
    category_id: categoryId,
    description_en: d.description_en.trim() || null,
    unit: d.unit.trim().replace(/^per\s+/i, "") || null,
    price_mode: mode,
    price_amount: amount,
    price_min: mode === "range" ? num(d.price_min) : null,
    price_max: mode === "range" ? num(d.price_max) : null,
    in_stock: d.in_stock,
    popular: d.popular,
    delivery_fee_kes: prev?.delivery_fee_kes ?? null,
    status: "active",
    sort: prev?.sort ?? 9999,
    source: prev?.source ?? "owner",
    legacy_ref: prev?.legacy_ref ?? null,
    row_version: d.row_version ?? prev?.row_version ?? 0,
  };
}

export function draftFromItem(it: KbItem | null, categories: KbCategory[], kind: KbKind = "service"): KbDraft {
  const cat = it?.category_id ? categories.find((c) => c.id === it.category_id)?.name_en ?? "" : "";
  return {
    id: it?.id,
    kind: it?.kind ?? kind,
    name_en: it?.name_en ?? "",
    category: cat,
    price_mode: it?.price_mode ?? "fixed",
    price_amount: it?.price_amount != null ? String(it.price_amount) : "",
    price_min: it?.price_min != null ? String(it.price_min) : "",
    price_max: it?.price_max != null ? String(it.price_max) : "",
    unit: it?.unit ?? "",
    aliases: (it?.aliases ?? []).join(", "),
    description_en: it?.description_en ?? "",
    popular: it?.popular ?? false,
    in_stock: it?.in_stock ?? null,
    row_version: it?.row_version,
  };
}

type LegacyRow = Record<string, unknown> & { id?: string };

/**
 * Mirror kb items onto today's services_catalog / product_catalog. Rows are merged by id, so fields the KB
 * does not carry (sku, booking notes, parsed_from on untouched rows) are kept. Hidden items leave the mirror.
 */
export function mirrorLegacy(
  items: KbItem[],
  categories: KbCategory[],
  existing: { services_catalog: unknown; product_catalog: unknown },
): { services_catalog: LegacyRow[]; product_catalog: LegacyRow[] } {
  const catName = new Map(categories.map((c) => [c.id, c.name_en]));
  const old = new Map<string, LegacyRow>();
  for (const r of [...(Array.isArray(existing.services_catalog) ? existing.services_catalog : []), ...(Array.isArray(existing.product_catalog) ? existing.product_catalog : [])] as LegacyRow[]) {
    if (r && r.id) old.set(String(r.id), r);
  }
  const services: LegacyRow[] = [];
  const products: LegacyRow[] = [];
  for (const it of [...items].sort((a, b) => a.sort - b.sort)) {
    if (it.status === "hidden") continue;
    const key = it.legacy_ref || it.id;
    const prev = old.get(key) || {};
    const price = displayPrice(it) || "";
    const mode = it.price_mode === "per_unit" ? "fixed" : it.price_mode;
    const amount = it.price_amount ?? it.price_min ?? null;
    const prevPricing = (prev.pricing && typeof prev.pricing === "object" ? prev.pricing : {}) as Record<string, unknown>;
    const pricing = {
      ...prevPricing,
      mode,
      unit: it.unit || null,
      amount_ksh: amount,
      min_ksh: it.price_min,
      max_ksh: it.price_max,
      parsed_from: amount != null && mode === "fixed" ? String(amount) : (prevPricing.parsed_from ?? null),
      in_stock: it.in_stock,
      confirmed: true,
      source: "owner",
    };
    const base: LegacyRow = {
      ...prev,
      id: key,
      name: it.name_en,
      notes: it.description_en || (prev.notes as string) || "",
      category: (it.category_id && catName.get(it.category_id)) || "",
      in_stock: it.in_stock === false ? "no" : it.in_stock === true ? "yes" : "",
      pricing,
      price_max: it.price_max,
    };
    if (it.kind === "product") products.push({ ...base, unit: it.unit ? `per ${it.unit}` : "", price, aliases: it.aliases, price_mode: mode });
    else services.push({ ...base, price: amount != null ? String(amount) : "", price_range: price, pricing_mode: mode });
  }
  return { services_catalog: services, product_catalog: products };
}

export const CHECK_LABEL: Record<string, string> = {
  kb_compiled: "Knowledge compiled",
  catalogue: "Every item has a price",
  reader_finds_items: "It can find your items",
  areas: "Service areas confirmed",
  hours: "Hours set",
  capture_path: "It can take a booking or a callback",
};
export const CHECK_FIX: Record<string, string> = {
  catalogue: "/settings/knowledge",
  areas: "/settings/areas",
  hours: "/settings?tab=train&panel=hours",
  kb_compiled: "/settings/knowledge",
  reader_finds_items: "/settings/knowledge",
};
export const ISSUE_LINE: Record<string, string> = {
  no_price: "has no price, so callers hear that you will confirm it",
  odd_price: "has a price that looks too low; check it",
  duplicate_name: "appears twice",
  sound_alike: "sounds like another item; add a word to tell them apart",
  alias_two_items: "is a nickname used for two items",
  one_item_categories: "Every item sits in its own group; group them so callers can narrow down",
  no_speakable_items: "Nothing to say yet: add at least one item",
  doc_too_large: "The catalogue is too large to compile",
  sw_name_waiting: "has a Swahili name waiting for you",
  no_sw_name: "has no Swahili name yet",
};
