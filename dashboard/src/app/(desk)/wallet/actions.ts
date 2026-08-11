"use server";

import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type OnDemandUsageState = {
  error?: string;
  ok?: boolean;
  enabled?: boolean;
};

/**
 * Owner opt-in on-demand usage when prepaid hits zero.
 * Requires docs/supabase/wallet_on_demand_alerts.sql.
 */
export async function saveOnDemandUsage(
  _prev: OnDemandUsageState,
  formData: FormData
): Promise<OnDemandUsageState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to change on-demand usage." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("tenant_id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const enabled = String(formData.get("enabled") || "") === "1";
  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { data, error } = await workspace.client.rpc("set_tenant_on_demand_usage", {
    p_tenant_id: tenant.id,
    p_enabled: enabled,
  });

  if (error) {
    const message = error.message || "Could not save on-demand setting";
    const hint = /function|schema cache|set_tenant_on_demand_usage/i.test(message)
      ? " Apply docs/supabase/wallet_on_demand_alerts.sql in Supabase."
      : "";
    return { error: `${message}${hint}` };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    enabled: Boolean(row?.on_demand_usage_enabled),
  };
}
