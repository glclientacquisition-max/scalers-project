import type { PriceKind } from "./catalogPricingMode";
import {
  type CatalogPriceFieldErrors,
  validateCatalogPriceFields,
} from "./catalogPricingMode";

export type CatalogPriceDraft = {
  kind: PriceKind;
  minInput: string;
  maxInput: string;
};

export type CatalogPriceTouch = {
  min: boolean;
  max: boolean;
};

export const emptyCatalogPriceTouch = (): CatalogPriceTouch => ({ min: false, max: false });

/** Preserve amount inputs across segment changes; Range keeps lowest from Fixed/From. */
export function transitionCatalogPriceKind(
  draft: CatalogPriceDraft,
  nextKind: PriceKind
): CatalogPriceDraft {
  const { minInput, maxInput } = draft;
  if (nextKind === "range" && (draft.kind === "fixed" || draft.kind === "from") && minInput.trim()) {
    return { kind: nextKind, minInput, maxInput };
  }
  return { kind: nextKind, minInput, maxInput };
}

/** Show validation only after blur or an explicit save attempt. */
export function catalogPriceFieldErrors(
  draft: CatalogPriceDraft,
  touch: CatalogPriceTouch,
  revealAll: boolean
): CatalogPriceFieldErrors {
  if (draft.kind === "quote") return {};
  const full = validateCatalogPriceFields(draft.kind, draft.minInput, draft.maxInput);
  const errors: CatalogPriceFieldErrors = {};
  if ((revealAll || touch.min) && full.min) errors.min = full.min;
  if ((revealAll || touch.max) && full.max) errors.max = full.max;
  return errors;
}
