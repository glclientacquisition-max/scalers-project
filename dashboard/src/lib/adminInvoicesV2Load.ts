import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { InvoiceRow } from "@/lib/ops/invoicesView";

/* eslint-disable @typescript-eslint/no-require-imports */
const { toCents } = require("./invoicePay/money.js");
/* eslint-enable @typescript-eslint/no-require-imports */

export const INVOICE_V2_LIMIT = 500;
const cents = (v: unknown) => Number(toCents(v) || BigInt(0));
const iso = (v: unknown) => (v ? String(v) : null);

/** Invoices with their lines, newest first. Reads only. */
export async function loadInvoicesV2(businessId?: string | null): Promise<{ rows: InvoiceRow[]; truncated: boolean }> {
  const admin = getSupabaseAdmin();
  const colsWithPause =
    "id, invoice_number, status, total_kes, amount_paid_kes, due_at, issued_at, paid_at, created_at, period_start, period_end, tenant_id, reminders_paused_at";
  const colsPlain =
    "id, invoice_number, status, total_kes, amount_paid_kes, due_at, issued_at, paid_at, created_at, period_start, period_end, tenant_id";
  let q = admin.from("invoices").select(colsWithPause).order("created_at", { ascending: false }).limit(INVOICE_V2_LIMIT + 1);
  if (businessId) q = q.eq("tenant_id", businessId);
  let { data, error } = await q;
  if (error && /reminders_paused_at/i.test(String(error.message || ""))) {
    let q2 = admin.from("invoices").select(colsPlain).order("created_at", { ascending: false }).limit(INVOICE_V2_LIMIT + 1);
    if (businessId) q2 = q2.eq("tenant_id", businessId);
    const retry = await q2;
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  const list = (data || []).slice(0, INVOICE_V2_LIMIT);
  const ids = list.map((r) => String(r.id));
  const tenantIds = [...new Set(list.map((r) => String(r.tenant_id)))];
  const [tenants, lines] = await Promise.all([
    tenantIds.length ? admin.from("tenants").select("id, business_name, alert_email").in("id", tenantIds) : Promise.resolve({ data: [] }),
    ids.length
      ? admin.from("invoice_lines").select("invoice_id, description, amount_kes, sort_order").in("invoice_id", ids).order("sort_order")
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((tenants.data || []) as { id: unknown; business_name: unknown; alert_email?: unknown }[]).map((t) => [String(t.id), String(t.business_name || "Business")]));
  const emails = new Map(((tenants.data || []) as { id: unknown; alert_email?: unknown }[]).map((t) => {
    const e = String(t.alert_email || "").trim().toLowerCase();
    return [String(t.id), e.includes("@") ? e : null] as const;
  }));
  const byInvoice = new Map<string, InvoiceRow["lines"]>();
  for (const l of (lines.data || []) as { invoice_id: unknown; description: unknown; amount_kes: unknown }[]) {
    const k = String(l.invoice_id);
    const arr = byInvoice.get(k) || [];
    arr.push({ description: String(l.description || ""), amountCents: cents(l.amount_kes) });
    byInvoice.set(k, arr);
  }
  return {
    truncated: (data || []).length > INVOICE_V2_LIMIT,
    rows: list.map((r) => ({
      id: String(r.id),
      number: r.invoice_number ? String(r.invoice_number) : "Draft",
      businessId: String(r.tenant_id),
      businessName: names.get(String(r.tenant_id)) || "Business",
      status: String(r.status || ""),
      totalCents: cents(r.total_kes),
      paidCents: cents(r.amount_paid_kes),
      dueAt: iso(r.due_at),
      issuedAt: iso(r.issued_at),
      paidAt: iso(r.paid_at),
      createdAt: String(r.created_at || ""),
      periodStart: iso(r.period_start),
      periodEnd: iso(r.period_end),
      lines: byInvoice.get(String(r.id)) || [],
      billingEmail: emails.get(String(r.tenant_id)) || null,
      remindersPausedAt: r.reminders_paused_at ? String(r.reminders_paused_at) : null,
    })),
  };
}
