import type { ReactNode } from "react";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import type { DataCheck } from "./DataChecksCard";
import { BusinessCategoryPicker } from "./BusinessCategoryPicker";
import { PaymentsEditor } from "./PaymentsEditor";
import { PriceConfirmCards, type PriceToConfirm } from "./PriceConfirmCards";
import { confirmPriceAction, saveBusinessCategoryAction, savePaymentsAction } from "@/app/(desk)/settings/structuredActions";
import { needsPriceConfirm, sanitizePricing, type Payments } from "@/lib/structuredData";

type Row = Record<string, unknown>;

/** Items whose typed price was read from text and not yet confirmed by the owner. */
export function pricesToConfirm(tenant: { product_catalog?: unknown; services_catalog?: unknown }): PriceToConfirm[] {
  const out: PriceToConfirm[] = [];
  const add = (rows: unknown, kind: "product" | "service", textKey: string) => {
    for (const r of Array.isArray(rows) ? (rows as Row[]) : []) {
      const pricing = sanitizePricing(r?.pricing);
      const name = String(r?.name || "").trim();
      if (!name || !pricing || !needsPriceConfirm({ pricing })) continue;
      out.push({ kind, name, pricing, text: String(r?.[textKey] || "") });
    }
  };
  add(tenant.product_catalog, "product", "price");
  add(tenant.services_catalog, "service", "price_range");
  return out;
}

export function paymentsFrom(policies: unknown): Payments | null {
  const p = policies && typeof policies === "object" ? (policies as Row).payments : null;
  if (!p || typeof p !== "object") return null;
  const r = p as Row;
  return {
    methods: Array.isArray(r.methods) ? (r.methods as Payments["methods"]) : [],
    mpesa_till: typeof r.mpesa_till === "string" ? r.mpesa_till : null,
    mpesa_paybill: r.mpesa_paybill && typeof r.mpesa_paybill === "object" ? (r.mpesa_paybill as Payments["mpesa_paybill"]) : null,
    timing: (r.timing as Payments["timing"]) ?? null,
    deposit_percent: typeof r.deposit_percent === "number" ? r.deposit_percent : null,
    source: r.source === "parsed" ? "parsed" : "owner",
    confirmed: r.confirmed !== false,
  };
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
}): Partial<Record<"identity" | "catalog" | "policies", ReactNode>> {
  const prices = pricesToConfirm(tenant);
  return {
    identity: (
      <BusinessCategoryPicker businessType={businessType} initial={businessCategory} canEdit={canEdit} save={saveBusinessCategoryAction} />
    ),
    catalog: prices.length ? <PriceConfirmCards items={prices} canEdit={canEdit} save={confirmPriceAction} /> : null,
    policies: <PaymentsEditor initial={paymentsFrom(tenant.business_policies)} canEdit={canEdit} save={savePaymentsAction} />,
  };
}

/** Overview checks (same rules as the Settings cards). */
export function dataChecksFor(tenant: { product_catalog?: unknown; services_catalog?: unknown; business_policies?: unknown }): DataCheck[] {
  const out: DataCheck[] = [];
  const prices = pricesToConfirm(tenant).length;
  if (prices) out.push({ href: businessSettingsHref("train", "catalog"), label: `Check ${prices} price${prices === 1 ? "" : "s"}`, detail: "We read them from your notes. Callers hear these." });
  const pay = paymentsFrom(tenant.business_policies);
  if (pay && !pay.confirmed) out.push({ href: businessSettingsHref("train", "policies"), label: "Check how customers pay", detail: "We read it from your payment notes." });
  return out;
}
