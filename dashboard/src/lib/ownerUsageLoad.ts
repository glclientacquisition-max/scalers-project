import "server-only";
import { loadOwnerBillingView } from "@/lib/billingStateLoad";
import { ownerBillingView, type OwnerBillingView } from "@/lib/billingStateModel";
import { loadOwnerPackageMeter } from "@/lib/packageCatalog";
import { isBetaBilling } from "@/lib/wallet";

/**
 * Usage rows from tenant_billing_state, or the tenant counters before that view
 * exists. Usage and the beta Plan page read the same numbers.
 */
export async function loadOwnerUsageView(tenant: {
  id: string;
  billing_enforcement?: string | null;
  on_demand_usage_enabled?: boolean | null;
}): Promise<OwnerBillingView> {
  const [billing, pack] = await Promise.all([loadOwnerBillingView(tenant.id), loadOwnerPackageMeter(tenant.id)]);
  if (billing) return billing;
  const onDemand = Boolean(tenant.on_demand_usage_enabled);
  return ownerBillingView({
    state: pack.packageName
      ? {
          package_state: "active",
          package_name: pack.packageName,
          included_minutes: pack.minutesIncluded,
          used_minutes: pack.minutesUsed,
          sms_included: pack.smsIncluded,
          sms_used: pack.smsUsed,
          on_demand_enabled: onDemand,
          mode_label: isBetaBilling(tenant.billing_enforcement) ? "beta" : onDemand ? "metered" : "capped",
        }
      : null,
    monthlyPriceKes: null,
    smsMessages: null,
    seatsIncluded: pack.seatsIncluded,
    seatsUsed: pack.seatsUsed,
    messagesSent: { email: pack.emailUsed, whatsapp: pack.waUsed },
  });
}
