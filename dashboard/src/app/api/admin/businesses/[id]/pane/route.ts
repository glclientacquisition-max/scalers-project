import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAdminBusinessById } from "@/lib/admin";
import { listOpsAuditLog, loadAdminBillingClient } from "@/lib/adminBilling";
import { loadInvoicesV2 } from "@/lib/adminInvoicesV2Load";
import { balanceCents, daysOverdue } from "@/lib/ops/invoicesView";
import { auditLabel, type BusinessPaneData, type PaneMoney, type PaneUsage } from "@/lib/ops/businessPane";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only: everything the shared business pane shows. Each part fails on its own (null), never the whole pane. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLegacyAuthenticated())) return NextResponse.json({ error: "ops_only" }, { status: 403 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "business id required" }, { status: 400 });
  try {
    const found = await getAdminBusinessById(id);
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const part = <T,>(label: string, p: Promise<T>) => p.catch((err) => { logAdminError(`business-pane:${label}`, err); return null; });
    const [billing, invoices, calls, audit] = await Promise.all([
      part("billing", loadAdminBillingClient(id)),
      part("invoices", loadInvoicesV2(id)),
      part("calls", (async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("calls")
          .select("id, created_at, duration_seconds, primary_intent, status")
          .eq("tenant_id", id)
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) throw error;
        return data || [];
      })()),
      part("audit", listOpsAuditLog(id, 10)),
    ]);
    const now = new Date();
    const usage: PaneUsage | null = billing ? {
      packageName: billing.row.packageName,
      period: billing.row.period,
      periodEndLabel: billing.row.periodEndLabel,
      minutesIncluded: billing.row.minutesIncluded,
      minutesUsed: billing.row.minutesUsed,
      minutesRemaining: billing.row.minutesRemaining,
      onDemand: billing.row.on_demand_usage_enabled,
      statusLabel: billing.row.statusLabel,
    } : null;
    const live = invoices ? invoices.rows.filter((r) => r.status === "open") : [];
    const money: PaneMoney | null = invoices ? {
      openCount: live.length,
      overdueCount: live.filter((r) => daysOverdue(r, now) > 0).length,
      balanceCents: live.reduce((s, r) => s + balanceCents(r), 0),
      lastPaidAt: invoices.rows.map((r) => r.paidAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null,
      lastInvoice: invoices.rows[0] ? { id: invoices.rows[0].id, number: invoices.rows[0].number, status: invoices.rows[0].status } : null,
    } : null;
    const body: BusinessPaneData & { business: typeof found.business } = {
      business: found.business,
      usage,
      money,
      calls: calls as BusinessPaneData["calls"],
      audit: audit ? audit.map((a) => ({ id: a.id, when: a.created_at, action: auditLabel(a.action), actor: a.actor === "ops" ? "operator not recorded" : a.actor })) : null,
    };
    return NextResponse.json(body);
  } catch (err) {
    logAdminError("business-pane", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
