import type { ReactNode } from "react";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import type { OverviewDataCheck } from "./OverviewDataChecksCard";
import { BusinessCategoryPicker } from "./BusinessCategoryPicker";
import { PriceConfirmCards, type PriceToConfirm } from "./PriceConfirmCards";
import { confirmPriceAction, saveBusinessCategoryAction } from "@/app/(desk)/settings/structuredActions";
import { needsPriceConfirm, sanitizePricing } from "@/lib/structuredData";
import { normalizePayments, type Payments } from "@/lib/payments";
import { AddPricesRow } from "./AddPricesRow";
import { isUnpricedRow } from "@/lib/catalogPricing";
import { unpricedLabelText } from "./unpricedCopy";

type Row = Record<string, unknown>;

/** Items whose typed price was read from text and not yet confirmed by the owner. */
export function pricesToConfirm(tenant: { product_catalog?: unknown; services_catalog?: unknown }): PriceToConfirm[] {
  const out: PriceToConfirm[] = [];
  const add = (rows: unknown, kind: "product" | "service", textKey: string) => {
    for (const r of Array.isArray(rows) ? (rows as Row[]) : []) {
      const pricing = sanitizePricing(r?.pricing);
      const name = String(r?.name || "").trim();
      const text = String(r?.[textKey] || "");
      if (!name || !pricing || !needsPriceConfirm({ pricing, text })) continue;
      const id = typeof r?.id === "string" && r.id.trim() ? r.id.trim() : null;
      out.push({ kind, id, name, pricing, text });
    }
  };
  add(tenant.product_catalog, "product", "price");
  add(tenant.services_catalog, "service", "price_range");
  return out;
}

/** Items with no price text at all. One "Add prices" prompt, not a card each. */
export function unpricedCount(tenant: { product_catalog?: unknown; services_catalog?: unknown }): number {
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  return (
    rows(tenant.product_catalog).filter((r) => isUnpricedRow(r, "product")).length +
    rows(tenant.services_catalog).filter((r) => isUnpricedRow(r, "service")).length
  );
}

export const UNPRICED_HREF = `${businessSettingsHref("catalog")}&filter=unpriced`;

export { unpricedLabelText as unpricedLabel } from "./unpricedCopy";

export function paymentsFrom(policies: unknown): Payments | null {
  const p = policies && typeof policies === "object" ? (policies as Row).payments : null;
  return normalizePayments(p);
}

export function structuredSettingsSlots({
  tenant,
  canEdit,
  businessType,
  businessCategory,
}: {
  tenant: { product_catalog?: unknown; services_catalog?: unknown; business_policies?: unknown };
  canEdit: boolean;
  businessType: string;
  businessCategory: string | null;
}): Partial<Record<"identity" | "catalog", ReactNode>> {
  const prices = pricesToConfirm(tenant);
  const unpriced = unpricedCount(tenant);
  return {
    identity: (
      <BusinessCategoryPicker businessType={businessType} initial={businessCategory} canEdit={canEdit} save={saveBusinessCategoryAction} />
    ),
    catalog:
      prices.length || unpriced ? (
        <div className="space-y-4">
          {unpriced ? <AddPricesRow count={unpriced} href={UNPRICED_HREF} /> : null}
          {prices.length ? <PriceConfirmCards items={prices} canEdit={canEdit} save={confirmPriceAction} /> : null}
        </div>
      ) : null,
  };
}

/** Overview checks (import-parsed facts only when save = confirm is on). */
export function dataChecksFor(
  tenant: { product_catalog?: unknown; services_catalog?: unknown; business_policies?: unknown },
  opts?: { saveIsConfirm?: boolean }
): OverviewDataCheck[] {
  const out: OverviewDataCheck[] = [];
  const priceItems = pricesToConfirm(tenant);
  if (priceItems.length) {
    const prices = priceItems.length;
    out.push({
      kind: "prices",
      href: businessSettingsHref("catalog"),
      label: `Check ${prices} price${prices === 1 ? "" : "s"}`,
      detail: opts?.saveIsConfirm
        ? "Imported from your notes. Press Save on Catalogue to use it."
        : "We read them from your notes. Callers hear these.",
      items: priceItems,
    });
  }
  const unpriced = unpricedCount(tenant);
  if (unpriced) {
    out.push({
      kind: "link",
      href: UNPRICED_HREF,
      label: unpricedLabelText(unpriced),
      detail: "Add a price, or choose Ask so callers get a call back.",
    });
  }
  const pay = paymentsFrom(tenant.business_policies);
  const payNeedsCheck = pay && (opts?.saveIsConfirm ? pay.source === "parsed" && !pay.confirmed : !pay.confirmed);
  if (payNeedsCheck && pay) {
    const legacy = String(
      (tenant.business_policies as { payment?: string } | null)?.payment || pay.parsed_from || ""
    ).trim();
    out.push({
      kind: "payments",
      href: businessSettingsHref("train", "policies"),
      label: "Check how customers pay",
      detail: opts?.saveIsConfirm
        ? "Imported from your payment notes. Press Save on Policies to use it."
        : "We read it from your payment notes.",
      payments: pay,
      legacyText: legacy,
    });
  }
  return out;
}
