import type { KbItem, KbPriceMode } from "./kbCore";
import { ownerPricing, type PriceConfirmInput } from "./priceBatch";

/**
 * "Is this right?" answers applied to kb_items once the KB is the source (30 Oct). Writing the old catalogue columns
 * there would be undone by the next KB mirror. Every price is validated first; one bad price or a missing item saves
 * nothing. Items are matched by id, else by name within the same kind (a package counts as a service).
 */
export function kbPriceEdits(
  items: KbItem[],
  inputs: PriceConfirmInput[],
): { ok: true; edits: KbItem[] } | { ok: false; error: string; fields?: Record<string, string> } {
  const out = new Map<string, KbItem>();
  for (const input of inputs) {
    const res = ownerPricing(input.pricing);
    if (!res.ok) return res;
    const p = res.pricing;
    const sameKind = (it: KbItem) => (input.kind === "product" ? it.kind === "product" : it.kind !== "product");
    const name = input.name.trim().toLowerCase();
    const hit =
      (input.id ? items.find((it) => it.id === input.id) : undefined) ??
      items.find((it) => sameKind(it) && it.status !== "hidden" && it.name_en.trim().toLowerCase() === name);
    if (!hit) return { ok: false, error: "That item is no longer in your catalogue." };
    const mode: KbPriceMode = p.mode === "ask" ? (hit.price_mode === "site_visit" ? "site_visit" : "quote") : p.mode;
    const next: KbItem = {
      ...(out.get(hit.id) ?? hit),
      price_mode: mode,
      price_amount: mode === "fixed" ? p.amount_ksh : null,
      price_min: mode === "from" || mode === "range" ? p.amount_ksh : null,
      price_max: mode === "range" ? p.max_ksh : null,
      unit: p.unit_label || p.unit || hit.unit,
    };
    out.set(hit.id, next);
  }
  return { ok: true, edits: [...out.values()] };
}
