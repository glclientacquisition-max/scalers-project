/**
 * Settings > Catalogue (KB v2), Desk view rules. Pure: no server imports, so tests and the dev fixture share them.
 * Wires only against the KB v2 contract in kbCore (KbItem, KbDraft, KbPasteRow). Copy is owner words:
 * no dashes, "business" never "tenant".
 */
import { draftErrors, draftFromItem, fmtKsh, type KbCategory, type KbDraft, type KbItem, type KbKind, type KbPasteRow, type KbPriceMode } from "./kbCore";

/** What the owner picks. "none" is not a choice: an item with no price shows "Needs a price" and nothing is selected. */
export type PriceChoice = Exclude<KbPriceMode, "none">;

/** Up front: one KSh box. Behind "Price changes?": the rest. Quote, Ask and Custom quote are one choice: "Custom quote". */
export const PRICE_CHOICES: { key: PriceChoice; label: string; needs: "amount" | "range" | "unit" | "nothing" }[] = [
  { key: "fixed", label: "One price", needs: "amount" },
  { key: "from", label: "Starting from", needs: "amount" },
  { key: "range", label: "Price range", needs: "range" },
  { key: "per_unit", label: "Per unit", needs: "unit" },
  { key: "quote", label: "Custom quote", needs: "nothing" },
  { key: "site_visit", label: "After a site visit", needs: "nothing" },
  { key: "free", label: "Free", needs: "nothing" },
];

/** Choices that need no number save the moment they are picked (one rule for Custom quote and site visit everywhere). */
export function savesInstantly(mode: KbPriceMode): boolean {
  return mode === "quote" || mode === "site_visit" || mode === "free";
}

const ksh = (n: number) => `KSh ${fmtKsh(n)}`;

/** An item counts as unpriced until the owner made a real price choice with its numbers. */
export function isUnpriced(it: Pick<KbItem, "price_mode" | "price_amount" | "price_min" | "price_max">): boolean {
  switch (it.price_mode) {
    case "fixed":
    case "from":
    case "per_unit":
      return it.price_amount == null;
    case "range":
      return it.price_min == null || it.price_max == null;
    case "quote":
    case "site_visit":
    case "free":
      return false;
    default:
      return true;
  }
}

/** The price as one line of words for the list: "KSh 3,000 to 6,000 per job", "Custom quote", "Needs a price". */
export function priceInWords(it: Pick<KbItem, "price_mode" | "price_amount" | "price_min" | "price_max" | "unit">): string {
  if (isUnpriced(it)) return "Needs a price";
  const per = it.unit ? ` per ${it.unit}` : "";
  switch (it.price_mode) {
    case "fixed":
      return `${ksh(it.price_amount as number)}${per}`;
    case "per_unit":
      return `${ksh(it.price_amount as number)} per ${it.unit || "unit"}`;
    case "from":
      return `From ${ksh(it.price_amount as number)}${per}`;
    case "range":
      return `${ksh(it.price_min as number)} to ${fmtKsh(it.price_max as number)}${per}`;
    case "quote":
      return "Custom quote";
    case "site_visit":
      return "Quote after a site visit";
    case "free":
      return "Free";
    default:
      return "Needs a price";
  }
}

export type ItemState = "offered" | "paused" | "not_offered";
export const STATE_LABEL: Record<ItemState, string> = { offered: "Offered", paused: "Paused", not_offered: "Not offered" };

export function itemState(it: Pick<KbItem, "status">): ItemState {
  return it.status === "paused" ? "paused" : it.status === "not_offered" ? "not_offered" : "offered";
}

/** Small tags after the price in a row. Only what differs from normal. */
export function rowTags(it: Pick<KbItem, "status" | "status_note" | "in_stock" | "kind" | "holdable">): string[] {
  const out: string[] = [];
  const s = itemState(it);
  if (s === "paused") out.push(it.status_note ? `Paused: ${it.status_note}` : "Paused");
  if (s === "not_offered") out.push("Not offered");
  if (s === "offered" && it.in_stock === false) out.push("Out of stock");
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Visible items only (hidden never reaches the page). */
export type CatalogueCounts = { total: number; services: number; products: number; needPrice: number; paused: number; notOffered: number };

export function catalogueCounts(items: KbItem[]): CatalogueCounts {
  const live = items.filter((i) => i.status !== "hidden");
  return {
    total: live.length,
    services: live.filter((i) => i.kind !== "product").length,
    products: live.filter((i) => i.kind === "product").length,
    // Not offered items are a "no", not something to price.
    needPrice: live.filter((i) => i.status !== "not_offered" && isUnpriced(i)).length,
    paused: live.filter((i) => i.status === "paused").length,
    notOffered: live.filter((i) => i.status === "not_offered").length,
  };
}

/** One line for the status card: "6 services · 2 need a price". */
export function statusLine(c: CatalogueCounts): string {
  if (!c.total) return "Nothing added yet";
  const what =
    c.services && c.products
      ? `${plural(c.services, "service", "services")} · ${plural(c.products, "product", "products")}`
      : c.products
        ? plural(c.products, "product", "products")
        : plural(c.services, "service", "services");
  const need = c.needPrice ? ` · ${c.needPrice} ${c.needPrice === 1 ? "needs" : "need"} a price` : " · all priced";
  return `${what}${need}`;
}

/** Fix opens the next item without a price, after `afterId` when given, wrapping round. */
export function nextUnpriced(items: KbItem[], afterId?: string | null): KbItem | null {
  const todo = items.filter((i) => i.status !== "hidden" && i.status !== "not_offered" && isUnpriced(i));
  if (!todo.length) return null;
  if (!afterId) return todo[0];
  const all = items.filter((i) => i.status !== "hidden");
  const at = all.findIndex((i) => i.id === afterId);
  const after = all.slice(at + 1).find((i) => todo.includes(i));
  return after || todo.find((i) => i.id !== afterId) || null;
}

export type ListFilter = { query: string; kind: "all" | KbKind; needPrice: boolean };

/** Search matches name, other names and the group. */
export function filterItems(items: KbItem[], categories: KbCategory[], f: ListFilter): KbItem[] {
  const q = f.query.trim().toLowerCase();
  const cat = new Map(categories.map((c) => [c.id, c.name_en.toLowerCase()]));
  return items.filter((it) => {
    if (it.status === "hidden") return false;
    if (f.kind !== "all" && (f.kind === "product" ? it.kind !== "product" : it.kind === "product")) return false;
    if (f.needPrice && (it.status === "not_offered" || !isUnpriced(it))) return false;
    if (!q) return true;
    const hay = [it.name_en, it.name_sw || "", ...(it.aliases || []), (it.category_id && cat.get(it.category_id)) || ""].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/** The search box shows once the list is long enough to need it. */
export const SEARCH_FROM = 10;

/** New items start with no price type picked, so "Needs a price" stays honest until the owner decides. */
export function newDraft(kind: KbKind, categories: KbCategory[]): KbDraft {
  return { ...draftFromItem(null, categories, kind), price_mode: "none", in_stock: kind === "product" ? true : null };
}

/** Existing item -> draft. An unpriced item shows no price type as picked. */
export function editDraft(it: KbItem, categories: KbCategory[]): KbDraft {
  const d = draftFromItem(it, categories);
  if (isUnpriced(it) && (it.price_mode === "none" || it.price_mode === "fixed")) return { ...d, price_mode: "none", price_amount: "" };
  return d;
}

/** Typing a number into the up-front box while nothing is picked means "One price". Clearing it goes back to no price. */
export function withAmount(d: KbDraft, text: string): KbDraft {
  const has = /\d/.test(text);
  if (d.price_mode === "none" && has) return { ...d, price_mode: "fixed", price_amount: text };
  if (d.price_mode === "fixed" && !text.trim()) return { ...d, price_mode: "none", price_amount: "" };
  return { ...d, price_amount: text };
}

/** Pick a price type. Numbers already typed carry across where they fit. */
export function withChoice(d: KbDraft, mode: PriceChoice): KbDraft {
  const next: KbDraft = { ...d, price_mode: mode };
  if (mode === "range" && !d.price_min && d.price_amount) next.price_min = d.price_amount;
  if ((mode === "fixed" || mode === "from" || mode === "per_unit") && !d.price_amount && d.price_min) next.price_amount = d.price_min;
  return next;
}

/** draftErrors plus the Desk rules the sheet adds (per unit needs its unit). */
export function sheetErrors(d: KbDraft): string[] {
  const out = draftErrors(d);
  if (d.price_mode === "per_unit" && !d.unit.trim()) out.push("Add what the price is per, like sqm or hour.");
  return out;
}

/** Saved message names what callers hear now. */
export function savedLine(d: KbDraft): string {
  if (d.status === "not_offered") return "Saved. Callers who ask hear that you don't offer it.";
  if (d.status === "paused") return "Saved. Callers who ask hear it is paused.";
  if (d.price_mode === "none") return "Saved. It still needs a price.";
  return "Saved. Calls use it within a minute.";
}

// ------------------------------------------------------------- paste a list preview

export type PasteSummary = { adds: number; updates: number; needPrice: number; skipped: number; ready: KbPasteRow[] };

export function pasteSummary(rows: KbPasteRow[]): PasteSummary {
  const ready = rows.filter((r) => !r.error);
  return {
    adds: ready.filter((r) => !r.match_id).length,
    updates: ready.filter((r) => r.match_id).length,
    needPrice: ready.filter((r) => r.price_mode === "none").length,
    skipped: rows.length - ready.length,
    ready,
  };
}

/** "12 new · 3 update a price · 2 need a price · 1 skipped" */
export function pasteSummaryLine(s: PasteSummary): string {
  const parts = [
    s.adds ? `${s.adds} new` : "",
    s.updates ? `${s.updates} ${s.updates === 1 ? "updates" : "update"} an item you have` : "",
    s.needPrice ? `${s.needPrice} ${s.needPrice === 1 ? "needs" : "need"} a price` : "",
    s.skipped ? `${s.skipped} skipped` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "Nothing to add";
}

/** One preview row in words. */
export function pasteRowLine(r: KbPasteRow): string {
  if (r.error) return r.error;
  const price = priceInWords(r);
  return r.match_id ? `${price} · updates the item you have` : price;
}
