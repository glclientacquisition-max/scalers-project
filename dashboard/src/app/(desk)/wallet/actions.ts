"use server";

import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { normalizeSoftSpendLimitKes } from "@/lib/wallet";

export type SoftSpendLimitState = {
  error?: string;
  ok?: boolean;
  enabled?: boolean;
  limitKes?: number | null;
};

/**
 * Owner opt-in soft spend budget (warn only; never blocks calls).
 * Requires docs/supabase/wallet_soft_spend_limit.sql.
 */
export async function saveSoftSpendLimit(
  _prev: SoftSpendLimitState,
  formData: FormData
): Promise<SoftSpendLimitState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to save your soft spend limit." };
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
  const rawLimit = formData.get("limit_kes");
  const limitKes = enabled ? normalizeSoftSpendLimitKes(rawLimit) : null;

  if (enabled && limitKes == null) {
    return { error: "Choose a monthly limit of at least KES 500." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { data, error } = await workspace.client.rpc("set_tenant_soft_spend_limit", {
    p_tenant_id: tenant.id,
    p_enabled: enabled,
    p_limit_kes: limitKes,
  });

  if (error) {
    const message = error.message || "Could not save soft spend limit";
    const hint = /function|schema cache|set_tenant_soft_spend_limit/i.test(message)
      ? " Apply docs/supabase/wallet_soft_spend_limit.sql in Supabase."
      : "";
    return { error: `${message}${hint}` };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    enabled: Boolean(row?.soft_spend_limit_enabled),
    limitKes:
      row?.soft_spend_limit_kes != null ? Number(row.soft_spend_limit_kes) : null,
  };
}
