import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ownerBillingView,
  type OwnerBillingView,
  type TenantBillingStateRow,
} from "@/lib/billingStateModel";

const STATE_COLS =
  "package_state, package_id, package_name, billing_term, period_start, period_end, included_minutes, used_seconds, used_minutes, remaining_minutes, sms_included, sms_used, sms_used_source, on_demand_enabled, enforcement_mode, mode_label, overage_owed_kes";

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Owner Usage from tenant_billing_state (Ops-Billing #650/#647). The caller has
 * already resolved tenantId through tenant_members (getCurrentTenant), so the
 * service-role read is scoped to the signed-in workspace. Two waves of
 * parallel reads; null when the view is not there yet.
 */
export async function loadOwnerBillingView(tenantId: string): Promise<OwnerBillingView | null> {
  if (!tenantId) return null;
  try {
    const admin = getSupabaseAdmin();
    const [stateRes, tenantRes, seatsRes] = await Promise.all([
      admin.from("tenant_billing_state").select(STATE_COLS).eq("tenant_id", tenantId).maybeSingle(),
      admin
        .from("tenants")
        .select("seat_included, email_used_units, whatsapp_used_units")
        .eq("id", tenantId)
        .maybeSingle(),
      admin.rpc("tenant_seats_used", { p_tenant: tenantId }),
    ]);
    if (stateRes.error) {
      console.warn("billing state unavailable", stateRes.error.code || stateRes.error.message);
      return null;
    }
    const state = (stateRes.data || null) as (TenantBillingStateRow & { package_id?: string | null }) | null;
    const tenant = (tenantRes.error ? {} : tenantRes.data || {}) as Record<string, unknown>;

    const active = state?.package_state === "active";
    const [priceRes, smsRes] = await Promise.all([
      active
        ? admin.from("billing_subscription_read").select("version_monthly_price_kes").eq("tenant_id", tenantId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      state?.period_start && state.sms_used_source === "ledger"
        ? (() => {
            let q = admin
              .from("notify_sms_billable")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .gte("created_at", state.period_start as string);
            if (state.period_end) q = q.lt("created_at", state.period_end);
            return q;
          })()
        : Promise.resolve({ count: null, error: null }),
    ]);

    const pinned = priceRes && !priceRes.error && priceRes.data
      ? (priceRes.data as { version_monthly_price_kes?: unknown }).version_monthly_price_kes
      : null;
    const price = pinned == null || pinned === "" ? null : num(pinned);
    const smsMessages =
      smsRes && !smsRes.error && typeof (smsRes as { count?: number | null }).count === "number"
        ? ((smsRes as { count: number }).count)
        : null;
    const seatsUsed = seatsRes.error ? 0 : num(seatsRes.data);

    return ownerBillingView({
      state,
      monthlyPriceKes: price,
      smsMessages,
      seatsIncluded: num(tenant.seat_included),
      seatsUsed,
      messagesSent: { email: num(tenant.email_used_units), whatsapp: num(tenant.whatsapp_used_units) },
    });
  } catch (err) {
    console.warn("billing state load failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Seats on the plan and seats in use (members plus open invites). Null when the counts are not there. */
export async function loadSeatCount(tenantId: string): Promise<{ used: number; included: number } | null> {
  if (!tenantId) return null;
  try {
    const admin = getSupabaseAdmin();
    const [tenantRes, seatsRes] = await Promise.all([
      admin.from("tenants").select("seat_included").eq("id", tenantId).maybeSingle(),
      admin.rpc("tenant_seats_used", { p_tenant: tenantId }),
    ]);
    if (tenantRes.error || seatsRes.error || !tenantRes.data) return null;
    const included = Math.max(0, Math.floor(num((tenantRes.data as { seat_included?: unknown }).seat_included)));
    return { used: Math.max(0, Math.floor(num(seatsRes.data))), included };
  } catch {
    return null;
  }
}
