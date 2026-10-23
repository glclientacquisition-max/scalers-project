import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { PaymentRow } from "@/lib/ops/paymentsView";

/* eslint-disable @typescript-eslint/no-require-imports */
const { toCents } = require("./invoicePay/money.js");
/* eslint-enable @typescript-eslint/no-require-imports */

export const PAYMENT_V2_LIMIT = 500;
const cents = (v: unknown) => Number(toCents(v) || BigInt(0));
const iso = (v: unknown) => (v ? String(v) : null);

/**
 * Recent payments, newest first. Reads only.
 * Skips checkout-total-review placeholders (those stay on Attention).
 */
export async function loadPaymentsV2(businessId?: string | null): Promise<{ rows: PaymentRow[]; truncated: boolean }> {
  const admin = getSupabaseAdmin();
  let q = admin
    .from("payments")
    .select("id, tenant_id, invoice_id, amount_kes, match_status, created_at, provider_ref, paid_at")
    .order("created_at", { ascending: false })
    .limit(PAYMENT_V2_LIMIT + 1);
  if (businessId) q = q.eq("tenant_id", businessId);
  const { data, error } = await q;
  if (error) throw error;

  const raw = (data || []).filter((r) => !String(r.provider_ref || "").startsWith("checkout-total-review:"));
  const list = raw.slice(0, PAYMENT_V2_LIMIT);
  const truncated = raw.length > PAYMENT_V2_LIMIT || (data || []).length > PAYMENT_V2_LIMIT;

  const tenantIds = [...new Set(list.map((r) => String(r.tenant_id || "")).filter(Boolean))];
  const invoiceIds = [...new Set(list.map((r) => (r.invoice_id ? String(r.invoice_id) : "")).filter(Boolean))];

  const [tenants, invoices] = await Promise.all([
    tenantIds.length
      ? admin.from("tenants").select("id, business_name").in("id", tenantIds)
      : Promise.resolve({ data: [] as { id: unknown; business_name: unknown }[] }),
    invoiceIds.length
      ? admin.from("invoices").select("id, invoice_number").in("id", invoiceIds)
      : Promise.resolve({ data: [] as { id: unknown; invoice_number: unknown }[] }),
  ]);

  const names = new Map(
    ((tenants.data || []) as { id: unknown; business_name: unknown }[]).map((t) => [
      String(t.id),
      String(t.business_name || "Business"),
    ]),
  );
  const numbers = new Map(
    ((invoices.data || []) as { id: unknown; invoice_number: unknown }[]).map((i) => [
      String(i.id),
      i.invoice_number ? String(i.invoice_number) : null,
    ]),
  );

  return {
    truncated,
    rows: list.map((r) => {
      const businessIdRow = r.tenant_id ? String(r.tenant_id) : "";
      const invoiceId = r.invoice_id ? String(r.invoice_id) : null;
      return {
        id: String(r.id),
        businessId: businessIdRow,
        businessName: names.get(businessIdRow) || (businessIdRow ? "Business" : "No business"),
        invoiceId,
        invoiceNumber: invoiceId ? numbers.get(invoiceId) ?? null : null,
        amountCents: cents(r.amount_kes),
        matchStatus: String(r.match_status || ""),
        providerRef: String(r.provider_ref || ""),
        paidAt: iso(r.paid_at),
        createdAt: String(r.created_at || ""),
      };
    }),
  };
}
