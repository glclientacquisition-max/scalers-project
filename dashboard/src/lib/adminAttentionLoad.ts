import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { OverdueInput, UsageInput } from "@/lib/ops/attentionView";

/* eslint-disable @typescript-eslint/no-require-imports */
const { toCents } = require("./invoicePay/money.js");
/* eslint-enable @typescript-eslint/no-require-imports */

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Open invoices past due with money still owed. Reads only. null when the read failed (the queue says so). */
export async function loadOverdueForAttention(limit = 200): Promise<OverdueInput[] | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("invoices")
      .select("id, tenant_id, invoice_number, total_kes, amount_paid_kes, due_at")
      .eq("status", "open")
      .lt("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(limit);
    if (error) return null;
    return (data || []).map((r) => {
      const left = (toCents(r.total_kes) || BigInt(0)) - (toCents(r.amount_paid_kes) || BigInt(0));
      return {
        id: String(r.id),
        tenantId: String(r.tenant_id),
        number: String(r.invoice_number || "Invoice"),
        owedCents: left > BigInt(0) ? Number(left) : 0,
        dueAt: String(r.due_at),
      };
    });
  } catch {
    return null;
  }
}

/** This period's package minutes and metered seconds per business. Reads only. null when the read failed. */
export async function loadUsageForAttention(): Promise<UsageInput[] | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("tenants")
      .select("id, minutes_included, seconds_used")
      .gt("minutes_included", 0);
    if (error) return null;
    return (data || []).map((r) => ({
      tenantId: String(r.id),
      includedMinutes: num(r.minutes_included),
      usedSeconds: num(r.seconds_used),
      packageName: null,
    }));
  } catch {
    return null;
  }
}
