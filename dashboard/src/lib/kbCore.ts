/**
 * v2 Knowledge Base, Desk side (pure; no server imports).
 * The call reads compiled snapshots (Voice src/knowledge/kb). Desk edits kb_items, mirrors today's catalogue
 * columns so older readers stay right, then asks Voice to compile. "What callers hear" lines come from the
 * snapshot (doc.preview), written by the same rules the call uses, so there is no second copy of them here.
 */
export type KbKind = "service" | "product" | "package";
export type KbPriceMode = "fixed" | "range" | "from" | "per_unit" | "quote" | "site_visit" | "free" | "none";
/** active: offered. paused: on hold for now (spoken "not available right now"). not_offered: an explicit "we don't do this". hidden: removed. */
export type KbStatus = "active" | "paused" | "not_offered" | "hidden";
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
  needs_visit: boolean;
  holdable: boolean;
  excludes_en: string | null;
  status_note: string | null;
  status: KbStatus;
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
    case "site_visit":
      return "After a site visit";
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
  status: Exclude<KbStatus, "hidden">;
  status_note: string;
  holdable: boolean;
  excludes_en: string;
  row_version?: number;
};

/** Plain checks before a save. Messages are owner words. */
export function draftErrors(d: KbDraft): string[] {
  const out: string[] = [];
  if (!d.name_en.trim()) out.push("Add a name.");
  if (d.name_en.trim().length > 120) out.push("Keep the name under 120 letters.");
  if (d.status_note.trim().length > 120) out.push("Keep the note under 120 letters.");
  if (d.excludes_en.trim().length > 500) out.push("Keep \"not included\" under 500 letters.");
  if (["fixed", "per_unit", "from"].includes(d.price_mode) && num(d.price_amount) == null) out.push("Add the price.");
  if (d.price_mode === "range") {
    const lo = num(d.price_min);
    const hi = num(d.price_max);
    if (lo == null || hi == null) out.push("Add the lowest and highest price.");
    else if (lo > hi) out.push("The lowest price is above the highest.");
  }
  return out;
}

/**
 * Item states flag gate for a save (DESK_KB_ITEM_STATES). Flag on: the draft as is. Flag off: a change TO paused or
 * not offered is ignored (the stored state and its note are kept; a new item stays offered), and the rest of the
 * save goes through. Putting a paused / not offered item back to Offered is still allowed (the Status control
 * offers it when the flag is off), so an already-paused item is never silently flipped either way.
 */
export function gateDraftStatus(d: KbDraft, prev: Pick<KbItem, "status" | "status_note"> | null, statesEnabled: boolean): KbDraft {
  if (statesEnabled) return d;
  if (d.status !== "paused" && d.status !== "not_offered") return d;
  const stored = prev?.status;
  if (stored === d.status) return d.status === "paused" ? { ...d, status_note: prev?.status_note ?? "" } : d;
  if (stored === "paused" || stored === "not_offered") return { ...d, status: stored, status_note: stored === "paused" ? prev?.status_note ?? "" : "" };
  return { ...d, status: "active", status_note: "" };
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
    needs_visit: mode === "site_visit" || (mode === "quote" && !!prev?.needs_visit),
    holdable: d.holdable,
    excludes_en: d.excludes_en.trim().slice(0, 500) || null,
    status_note: d.status === "paused" ? d.status_note.trim().slice(0, 120) || null : null,
    status: d.status,
    sort: prev?.sort ?? 9999,
    source: prev?.source ?? "owner",
    legacy_ref: prev?.legacy_ref ?? null,
    row_version: d.row_version ?? prev?.row_version ?? 0,
  };
}

/** Content an owner can change (not row_version / sort / source). Equal content: the save is a no-op. */
export function sameKbContent(a: KbItem, b: KbItem): boolean {
  const pick = (i: KbItem) =>
    JSON.stringify([
      i.kind, i.name_en, i.name_sw ?? null, i.name_sw_state, [...(i.aliases || [])], i.category_id ?? null, i.description_en ?? null, i.unit ?? null,
      i.price_mode, i.price_amount ?? null, i.price_min ?? null, i.price_max ?? null, i.in_stock ?? null, !!i.popular, !!i.needs_visit,
      !!i.holdable, i.excludes_en ?? null, i.status_note ?? null, i.status,
    ]);
  return pick(a) === pick(b);
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
    status: it && it.status !== "hidden" ? it.status : "active",
    status_note: it?.status_note ?? "",
    holdable: it?.holdable ?? false,
    excludes_en: it?.excludes_en ?? "",
    row_version: it?.row_version,
  };
}

type LegacyRow = Record<string, unknown> & { id?: string };

/**
 * Mirror kb items onto today's services_catalog / product_catalog. Rows are merged by id, so fields the KB
 * does not carry (sku, booking notes, parsed_from on untouched rows) are kept. Hidden and not-offered items leave the
 * mirror (the old readers only know "offered"); a paused item reads as out of stock; a site visit is the old Quote plus
 * site_visit_required.
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
    if (it.status === "hidden" || it.status === "not_offered") continue;
    const paused = it.status === "paused";
    // legacy_ref names the old column (services_catalog / product_catalog), not the row: the kb id IS the old row id.
    const key = it.id;
    const prev = old.get(key) || {};
    const price = displayPrice(it) || "";
    const mode = it.price_mode === "per_unit" ? "fixed" : it.price_mode === "site_visit" ? "quote" : it.price_mode;
    const amount = it.price_amount ?? it.price_min ?? null;
    const prevPricing = (prev.pricing && typeof prev.pricing === "object" ? prev.pricing : {}) as Record<string, unknown>;
    // pricing.mode keeps the old Desk vocabulary (fixed / from / range / ask; catalogue_price_history checks it):
    // quote and site visit are a deliberate ask (owner, confirmed), no price yet is an unconfirmed ask, free is 0.
    const pricingMode = mode === "fixed" || mode === "from" || mode === "range" ? mode : mode === "free" ? "fixed" : "ask";
    const pricingOwner = mode === "none" ? { confirmed: false, source: "parsed" } : { confirmed: true, source: "owner" };
    const pricing = {
      ...prevPricing,
      mode: pricingMode,
      unit: it.unit || null,
      amount_ksh: amount,
      min_ksh: it.price_min,
      max_ksh: it.price_max,
      parsed_from: amount != null && mode === "fixed" ? String(amount) : (prevPricing.parsed_from ?? null),
      in_stock: paused ? false : it.in_stock,
      ...pricingOwner,
    };
    const base: LegacyRow = {
      ...prev,
      id: key,
      name: it.name_en,
      notes: it.description_en || (prev.notes as string) || "",
      category: (it.category_id && catName.get(it.category_id)) || "",
      in_stock: paused || it.in_stock === false ? "no" : it.in_stock === true ? "yes" : "",
      pricing,
      price_max: it.price_max,
    };
    if (it.kind === "product") products.push({ ...base, unit: it.unit ? `per ${it.unit}` : "", price, aliases: it.aliases, price_mode: mode, holdable: !!it.holdable });
    else services.push({ ...base, price: amount != null ? String(amount) : "", price_range: price, pricing_mode: mode, out_of_scope: it.excludes_en || (prev.out_of_scope as string) || "", site_visit_required: !!it.needs_visit || it.price_mode === "site_visit" });
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
  sw_name_waiting: "has a Kiswahili name waiting for you",
  no_sw_name: "has no Kiswahili name yet",
};

// ---------------------------------------------------------------- paste a list (Desk bulk import)
export type KbPasteRow = {
  line: number;
  raw: string;
  name_en: string;
  price_mode: KbPriceMode;
  price_amount: number | null;
  price_min: number | null;
  price_max: number | null;
  unit: string | null;
  /** id of an item with the same name already in the catalogue: the import updates it instead of adding a copy */
  match_id: string | null;
  error: string | null;
};
export const PASTE_MAX_ROWS = 500;

const PRICE_TAIL =
  /^(.*?)(?:\s*[-–—:|,;\t]\s*|\s+)((?:from\s+|kuanzia\s+)?(?:ksh?s?\.?|kes|sh\.?)?\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:-|–|to|hadi)\s*(?:ksh?s?\.?|kes|sh\.?)?\s*\d[\d,]*(?:\.\d+)?)?\s*(?:\/-)?(?:\s*(?:\/|per|kwa|a|an)\s*[a-z][a-z ]{0,20}|\s+each)?)\s*$/i;
const WORD_TAIL = /^(.*?)\s*[-–—:|,;\t]\s*(custom quote|quote|on request|price on request|site visit|after (?:a )?site visit|free)\s*$/i;

function parsePrice(t: string): Pick<KbPasteRow, "price_mode" | "price_amount" | "price_min" | "price_max" | "unit"> {
  const s = t.trim();
  const unitM = s.match(/(?:\/|\bper\b|\bkwa\b|\beach\b|\ba\b|\ban\b)\s*([a-z][a-z ]{0,20})$/i);
  const unit = unitM ? (unitM[1].trim().toLowerCase() === "each" ? "piece" : unitM[1].trim().toLowerCase()) : /\beach\b/i.test(s) ? "piece" : null;
  const nums = [...s.replace(/(\d),(\d)/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (nums.length >= 2 && /(-|–|\bto\b|\bhadi\b)/i.test(s)) {
    const [lo, hi] = [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
    return { price_mode: "range", price_amount: null, price_min: lo, price_max: hi, unit };
  }
  if (nums.length) return { price_mode: /^(from|kuanzia)\b/i.test(s) ? "from" : "fixed", price_amount: nums[0], price_min: null, price_max: null, unit };
  return { price_mode: "none", price_amount: null, price_min: null, price_max: null, unit: null };
}

/**
 * A pasted list -> rows to preview. One item per line, price optional at the end:
 * "Deep clean - 6,000-12,000", "Gloria F1, 3 per seedling", "Carpet cleaning: quote", "Ansal F1	2.50".
 * A first line that reads like a CSV header (name,price) is skipped. Nothing is saved here.
 */
export function parsePasteList(text: string, existing: Pick<KbItem, "id" | "name_en">[] = []): KbPasteRow[] {
  const byName = new Map(existing.map((e) => [e.name_en.trim().toLowerCase(), e.id]));
  const seen = new Set<string>();
  const out: KbPasteRow[] = [];
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  lines.forEach((rawLine, i) => {
    const raw = rawLine.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim();
    if (!raw) return;
    if (i === 0 && /^name\s*[,\t;|]\s*price/i.test(raw)) return;
    let name = raw;
    let price: ReturnType<typeof parsePrice> = { price_mode: "none", price_amount: null, price_min: null, price_max: null, unit: null };
    const w = raw.match(WORD_TAIL);
    const m = w ? null : raw.match(PRICE_TAIL);
    if (w) {
      name = w[1];
      const word = w[2].toLowerCase();
      price = { ...price, price_mode: /visit/.test(word) ? "site_visit" : word === "free" ? "free" : "quote", price_amount: word === "free" ? 0 : null };
    } else if (m && m[1].trim() && /[a-z]/i.test(m[1])) {
      name = m[1];
      price = parsePrice(m[2]);
    }
    name = name.replace(/\s*[-–—:|,;]\s*$/, "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    let error: string | null = null;
    if (!name || !/[a-z]/i.test(name)) error = "No name on this line.";
    else if (name.length > 120) error = "Name is over 120 letters.";
    else if (seen.has(key)) error = "Same name as a line above.";
    if (out.length >= PASTE_MAX_ROWS) error = `Only the first ${PASTE_MAX_ROWS} lines are added at once.`;
    seen.add(key);
    out.push({ line: i + 1, raw: rawLine, name_en: name.slice(0, 120), ...price, match_id: byName.get(key) ?? null, error });
  });
  return out;
}

/** Preview rows -> kb_items rows for one batch upsert. Matching names update the existing item's price only. */
export function itemsFromPaste(rows: KbPasteRow[], kind: KbKind, existing: KbItem[], categoryId: string | null): KbItem[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  let sort = existing.reduce((m, e) => Math.max(m, e.sort || 0), 0);
  return rows.filter((r) => !r.error).map((r) => {
    const prev = r.match_id ? byId.get(r.match_id) || null : null;
    const price = { price_mode: r.price_mode, price_amount: r.price_amount, price_min: r.price_min, price_max: r.price_max };
    if (prev) return { ...prev, ...(r.price_mode !== "none" ? price : {}), unit: r.unit ?? prev.unit, needs_visit: r.price_mode === "site_visit" || prev.needs_visit, status: prev.status === "hidden" ? "active" : prev.status };
    sort += 1;
    return {
      id: newItemId(kind), kind, name_en: r.name_en, name_sw: null, name_sw_state: "none", name_sw_suggested: null, aliases: [],
      category_id: categoryId, description_en: null, unit: r.unit, ...price, in_stock: null, popular: false, delivery_fee_kes: null,
      needs_visit: r.price_mode === "site_visit", holdable: false, excludes_en: null, status_note: null, status: "active",
      sort, source: "import", legacy_ref: null, row_version: 0,
    } as KbItem;
  });
}
