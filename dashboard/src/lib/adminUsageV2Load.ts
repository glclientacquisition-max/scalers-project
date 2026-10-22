import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import type { UsageCall, UsageInput } from "@/lib/ops/usageView";

const num = (raw: unknown) => (Number.isFinite(Number(raw)) ? Number(raw) : 0);
const DAY_MS = 86400 * 1000;

export type UsageLoad = UsageInput & { tenantId: string; currentPeriod: boolean };

/**
 * Read-only usage for one business (ADMIN_V2). Current period from tenant_billing_state, or a past period
 * passed as from/to (from an invoice line). Calls carry id, time, duration, intent and resolution only:
 * no caller number. Caller must gate with requireSuperAdmin.
 */
export async function loadUsageV2(tenantId: string, range: { from?: string | null; to?: string | null }): Promise<UsageLoad | null> {
  const admin = getSupabaseAdmin();
  const [tenantRes, stateRes] = await Promise.all([
    admin.from("tenants").select("id, business_name, minutes_included, seconds_used").eq("id", tenantId).maybeSingle(),
    admin
      .from("tenant_billing_state")
      .select("package_name, period_start, period_end, included_minutes, used_seconds, on_demand_enabled, overage_owed_kes")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (tenantRes.error) throw tenantRes.error;
  if (!tenantRes.data) return null;
  const t = tenantRes.data as { business_name: string | null; minutes_included: number | null; seconds_used: number | null };
  const s = (stateRes.error ? null : stateRes.data) as {
    package_name: string | null; period_start: string | null; period_end: string | null; included_minutes: number | null;
    used_seconds: number | null; on_demand_enabled: boolean | null; overage_owed_kes: number | null;
  } | null;

  const valid = (v?: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const from = valid(range.from);
  const to = valid(range.to);
  const past = Boolean(from && to && (!s?.period_start || Date.parse(from) !== Date.parse(s.period_start)));
  let periodStart = past ? from : s?.period_start ?? null;
  let periodEnd = past && to ? new Date(Date.parse(to) + (to.endsWith("T00:00:00.000Z") ? DAY_MS : 0)).toISOString() : s?.period_end ?? null;
  if (!periodStart || !periodEnd) {
    periodEnd = new Date().toISOString();
    periodStart = new Date(Date.now() - 30 * DAY_MS).toISOString();
  }

  const { data, error } = await admin
    .from("calls")
    .select("id, created_at, duration_seconds, primary_intent, resolution")
    .eq("tenant_id", tenantId)
    .gte("created_at", periodStart)
    .lt("created_at", periodEnd)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const calls: UsageCall[] = ((data || []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    durationSeconds: num(r.duration_seconds),
    intent: r.primary_intent ? String(r.primary_intent) : null,
    resolution: r.resolution ? String(r.resolution) : null,
  }));
  const callSeconds = calls.reduce((a, c) => a + c.durationSeconds, 0);
  return {
    tenantId,
    currentPeriod: !past,
    businessName: String(t.business_name || "Business"),
    packageName: s?.package_name ?? null,
    periodStart,
    periodEnd,
    includedMinutes: num(s?.included_minutes ?? t.minutes_included),
    meteredSeconds: past ? callSeconds : num(s?.used_seconds ?? t.seconds_used),
    onDemandEnabled: Boolean(s?.on_demand_enabled),
    onDemandOwedKes: !past && s?.overage_owed_kes != null ? num(s.overage_owed_kes) : null,
    calls,
  };
}
