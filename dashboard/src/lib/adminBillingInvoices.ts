import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TodayQueueRow } from "@/lib/adminTodayModel";
import { shopHref } from "@/lib/adminTodayModel";
import {
  earliestPeriodEndLabel,
  invoiceOverdue,
  periodEndWithinRolloverWindow,
  ROLLOVER_SOON_MS,
} from "@/lib/adminBillingPeriod";

export { earliestPeriodEndLabel, invoiceOverdue, periodEndWithinRolloverWindow, ROLLOVER_SOON_MS };

/* eslint-disable @typescript-eslint/no-require-imports */
const { listOwnerInvoices } = require("./invoicePay/invoiceList.js");
const { toCents, formatKsh } = require("./invoicePay/money.js");
/* eslint-enable @typescript-eslint/no-require-imports */

export type AdminShopInvoiceRow = {
  id: string;
  number: string;
  statusLabel: string;
  totalLabel: string;
  balanceLabel: string;
  dueAt: string | null;
  pdfPath: string;
  htmlPath: string;
  canMintPayLink: boolean;
};

export type PlatformInvoiceStats = {
  openCount: number;
  overdueCount: number;
  openKesLabel: string;
  missing: boolean;
};

function owedCents(total: unknown, paid: unknown): number {
  const left = (toCents(total) || BigInt(0)) - (toCents(paid) || BigInt(0));
  return left > BigInt(0) ? Number(left) : 0;
}

function isMissingInvoices(err: { message?: string } | null | undefined): boolean {
  const msg = String(err?.message || "");
  return /invoices|does not exist|schema cache/i.test(msg);
}

export async function loadPlatformInvoiceStats(): Promise<PlatformInvoiceStats> {
  const empty: PlatformInvoiceStats = { openCount: 0, overdueCount: 0, openKesLabel: "KSh 0", missing: false };
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("invoices")
      .select("status, total_kes, amount_paid_kes, due_at")
      .eq("status", "open");
    if (error) {
      if (isMissingInvoices(error)) return { ...empty, missing: true };
      throw error;
    }
    const now = Date.now();
    let openCents = 0;
    let overdueCount = 0;
    for (const row of data || []) {
      const owed = owedCents(row.total_kes, row.amount_paid_kes);
      if (owed <= 0) continue;
      openCents += owed;
      if (invoiceOverdue(row.due_at ? String(row.due_at) : null, "open", now)) overdueCount += 1;
    }
    return {
      openCount: (data || []).filter((r) => owedCents(r.total_kes, r.amount_paid_kes) > 0).length,
      overdueCount,
      openKesLabel: formatKsh(BigInt(openCents)),
      missing: false,
    };
  } catch {
    return { ...empty, missing: true };
  }
}

function adminStatusLabel(status: string, dueAt: string | null): string {
  const name = String(status || "open").toLowerCase();
  if (name === "paid") return "Paid";
  if (name === "void") return "Void";
  if (name === "draft") return "Draft";
  if (invoiceOverdue(dueAt, "open")) return "Overdue";
  if (name === "open") return dueAt ? "Open" : "Open";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export async function loadAdminShopInvoices(tenantId: string): Promise<{
  ok: boolean;
  missing: boolean;
  invoices: AdminShopInvoiceRow[];
}> {
  if (!tenantId) return { ok: false, missing: false, invoices: [] };
  try {
    const admin = getSupabaseAdmin();
    const listed = await listOwnerInvoices(admin, tenantId);
    if (!listed.ok) {
      return { ok: false, missing: /load/i.test(String(listed.error)), invoices: [] };
    }
    const body = listed.body as { invoices?: Array<Record<string, unknown>> };
    const invoices = (body.invoices || []).map((row) => {
      const id = String(row.id);
      const dueAt = row.due_at ? String(row.due_at) : null;
      const status = String(row.status || "open");
      return {
        id,
        number: String(row.number || "Invoice"),
        statusLabel: adminStatusLabel(status, dueAt),
        totalLabel: String(row.total_due || "KSh 0"),
        balanceLabel: String(row.balance || "KSh 0"),
        dueAt,
        pdfPath: `/api/admin/billing/invoices/${id}/pdf`,
        htmlPath: `/api/admin/billing/invoices/${id}?format=html`,
        canMintPayLink:
          status === "open" &&
          (Boolean(row.pay_link_path) || String(row.balance || "").trim() !== "KSh 0"),
      };
    });
    return { ok: true, missing: false, invoices };
  } catch {
    return { ok: false, missing: false, invoices: [] };
  }
}

export async function mintAdminInvoicePayLink(invoiceId: string, businessId: string): Promise<{ payPath: string } | { error: string }> {
  const admin = getSupabaseAdmin();
  const invoice = await admin
    .from("invoices")
    .select("id, status, tenant_id")
    .eq("id", invoiceId)
    .eq("tenant_id", businessId)
    .maybeSingle();
  if (invoice.error) return { error: "Could not load this invoice." };
  if (!invoice.data) return { error: "Invoice not found." };
  if (invoice.data.status !== "open") return { error: "This invoice is not open." };
  const minted = await admin.rpc("mint_invoice_pay_token", { p_invoice_id: invoiceId, p_rotate: false });
  if (minted.error) {
    const message = minted.error.message || "";
    if (/already exists/i.test(message)) return { error: "Pay link already issued." };
    if (/beta|cannot be paid|nothing left/i.test(message)) return { error: "This invoice cannot be paid here." };
    return { error: "Could not create a pay link." };
  }
  const token = minted.data && minted.data[0] && minted.data[0].token;
  if (!token) return { error: "Could not create a pay link." };
  return { payPath: `/pay/${token}` };
}

export async function loadOverdueInvoiceTodayRows(limit = 12): Promise<TodayQueueRow[]> {
  try {
    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from("invoices")
      .select("id, tenant_id, invoice_number, total_kes, amount_paid_kes, due_at, status")
      .eq("status", "open")
      .lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(limit);
    if (error) {
      if (isMissingInvoices(error)) return [];
      throw error;
    }
    const rows = data || [];
    if (!rows.length) return [];
    const tenantIds = [...new Set(rows.map((r) => String(r.tenant_id)))];
    const { data: tenants } = await admin.from("tenants").select("id, business_name").in("id", tenantIds);
    const nameById = new Map((tenants || []).map((t) => [String(t.id), String(t.business_name || "Business")]));
    return rows.flatMap((row) => {
      const owed = owedCents(row.total_kes, row.amount_paid_kes);
      if (owed <= 0) return [];
      const tenantId = String(row.tenant_id);
      const number = String(row.invoice_number || "Invoice");
      return [{
        key: `inv-${row.id}`,
        title: nameById.get(tenantId) || "Business",
        detail: `${number} · ${formatKsh(BigInt(owed))} overdue`,
        href: `${shopHref(tenantId)}?money=1`,
        stamp: "Overdue",
      }];
    });
  } catch {
    return [];
  }
}
