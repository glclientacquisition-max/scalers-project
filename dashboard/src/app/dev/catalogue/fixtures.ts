import type { KbCategory, KbItem, KbReadiness, KbSnapshotRow } from "@/lib/kbCore";

/** Invented businesses for the Catalogue dev page. Done and Dusted Cleaning (home services), Chapter One (shop). */
const base = (o: Partial<KbItem> & Pick<KbItem, "id" | "name_en">): KbItem => ({
  kind: "service",
  name_sw: null,
  name_sw_state: "none",
  name_sw_suggested: null,
  aliases: [],
  category_id: null,
  description_en: null,
  unit: null,
  price_mode: "none",
  price_amount: null,
  price_min: null,
  price_max: null,
  in_stock: null,
  popular: false,
  delivery_fee_kes: null,
  needs_visit: false,
  holdable: false,
  excludes_en: null,
  status_note: null,
  status: "active",
  sort: 0,
  source: "owner",
  legacy_ref: null,
  row_version: 1,
  ...o,
});

export const homeCategories: KbCategory[] = [
  { id: "home-cleaning", name_en: "Home cleaning", name_sw: null, name_sw_state: "none", sort: 1 },
  { id: "upholstery", name_en: "Sofas and carpets", name_sw: null, name_sw_state: "none", sort: 2 },
  { id: "offices", name_en: "Offices", name_sw: null, name_sw_state: "none", sort: 3 },
];

export const homeItems: KbItem[] = [
  base({ id: "svc_deep", name_en: "Deep clean", category_id: "home-cleaning", unit: "job", price_mode: "range", price_min: 6000, price_max: 12000, popular: true, sort: 1, excludes_en: "Outside windows" }),
  base({ id: "svc_move", name_en: "Move out clean", category_id: "home-cleaning", price_mode: "site_visit", needs_visit: true, sort: 2 }),
  base({ id: "svc_kitchen", name_en: "Kitchen deep clean", category_id: "home-cleaning", price_mode: "from", price_amount: 4000, sort: 3 }),
  base({ id: "svc_sofa", name_en: "Sofa cleaning", category_id: "upholstery", unit: "seat", price_mode: "per_unit", price_amount: 800, aliases: ["couch cleaning"], sort: 4, name_sw_state: "suggested", name_sw_suggested: "Usafi wa sofa" }),
  base({ id: "svc_carpet", name_en: "Carpet cleaning", category_id: "upholstery", price_mode: "quote", sort: 5 }),
  base({ id: "svc_mattress", name_en: "Mattress cleaning", category_id: "upholstery", price_mode: "fixed", price_amount: 2500, sort: 6 }),
  base({ id: "svc_office", name_en: "Office cleaning", category_id: "offices", sort: 7 }),
  base({ id: "svc_window", name_en: "Window cleaning", category_id: "home-cleaning", sort: 8 }),
  base({ id: "svc_laundry", name_en: "Laundry", category_id: "home-cleaning", unit: "kg", price_mode: "per_unit", price_amount: 150, sort: 9 }),
  base({ id: "svc_car", name_en: "Car interior clean", price_mode: "fixed", price_amount: 3500, sort: 10 }),
  base({ id: "svc_construction", name_en: "After builders clean", category_id: "home-cleaning", price_mode: "site_visit", needs_visit: true, status: "paused", status_note: "back in January", sort: 11 }),
  base({ id: "svc_pest", name_en: "Pest control", status: "not_offered", sort: 12 }),
];

export const shopCategories: KbCategory[] = [
  { id: "novels", name_en: "Novels", name_sw: null, name_sw_state: "none", sort: 1 },
  { id: "school", name_en: "School books", name_sw: null, name_sw_state: "none", sort: 2 },
];

export const shopItems: KbItem[] = [
  base({ id: "prd_ngugi", kind: "product", name_en: "Weep Not, Child", category_id: "novels", price_mode: "fixed", price_amount: 950, in_stock: true, holdable: true, sort: 1 }),
  base({ id: "prd_river", kind: "product", name_en: "The River Between", category_id: "novels", price_mode: "fixed", price_amount: 850, in_stock: false, sort: 2 }),
  base({ id: "prd_kcse", kind: "product", name_en: "KCSE revision pack", category_id: "school", price_mode: "range", price_min: 1200, price_max: 2400, in_stock: true, sort: 3 }),
  base({ id: "prd_atlas", kind: "product", name_en: "Kenya school atlas", category_id: "school", in_stock: true, sort: 4 }),
  base({ id: "prd_order", kind: "product", name_en: "Special order book", price_mode: "quote", sort: 5 }),
  base({ id: "svc_print", name_en: "Printing", unit: "page", price_mode: "per_unit", price_amount: 10, sort: 6 }),
  base({ id: "svc_bind", name_en: "Binding", price_mode: "from", price_amount: 150, sort: 7 }),
];

export const readinessTodo: KbReadiness = {
  snapshot_version: 2,
  passed: false,
  checks: [
    { id: "kb_compiled", ok: true },
    { id: "catalogue", ok: false },
    { id: "reader_finds_items", ok: true },
    { id: "areas", ok: false },
    { id: "hours", ok: true },
    { id: "capture_path", ok: true },
  ],
  tests: [],
  checked_at: "2026-10-28T08:00:00Z",
};

export const homeLive: KbSnapshotRow = {
  version: 2,
  status: "live",
  issues: [{ code: "no_price", severity: "warn", item_id: "svc_office" }],
  item_count: 12,
  compiled_at: "2026-10-28T08:00:00Z",
  doc: {
    preview: [
      { asked: "How much is a deep clean?", en: "A deep clean is 6,000 to 12,000 shillings per job, depending on the size of the house.", sw: "Usafi wa kina ni shilingi 6,000 hadi 12,000 kwa kazi moja." },
      { asked: "Do you clean carpets?", en: "Yes. Carpet cleaning is a custom quote; the team will give you a price after checking the job.", sw: null },
    ],
  },
};
