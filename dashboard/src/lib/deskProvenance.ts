import "server-only";

/**
 * Desk glue over Platform provenance.
 *
 * Live reads and writes come from tenantFieldProvenance and
 * catalogImportRecompile. When an RPC is missing, Home falls back to the
 * local stub (owner 100, import and seed 0). Confirm also stamps JSON so
 * the compiler can see owner source before it reads tenant_field_meta.
 */

import { recompileAfterCatalogImport } from "@/lib/catalogImportRecompile";
import {
  holdCaptureTenant,
  scoreCaptureTenant,
  type ScoreTenant,
} from "@/lib/completenessStub";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant";
import {
  confirmTenantField as confirmTenantFieldRpc,
  getTenantCompletenessScore as getTenantCompletenessScoreRpc,
  getTenantHoldGate as getTenantHoldGateRpc,
  upsertTenantFieldMeta,
  type TenantCompletenessScore,
  type TenantHoldGate,
} from "@/lib/tenantFieldProvenance";
import type { SupabaseClient } from "@supabase/supabase-js";

export type { TenantCompletenessScore, TenantHoldGate };
export { recompileAfterCatalogImport, upsertTenantFieldMeta };

const MISSING_RPC =
  /PGRST202|42883|does not exist|Could not find the function|schema cache/i;

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return MISSING_RPC.test(`${error.code || ""} ${error.message || ""}`);
}

async function rpcIsMissing(name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc(name, args);
    return isMissingRpc(error);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return isMissingRpc({ message });
  }
}

async function loadScoreTenant(tenantId: string): Promise<ScoreTenant | null> {
  const current = await getCurrentTenant();
  if (current && current.id === tenantId) return current;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (error || !data) return null;
    return data as ScoreTenant;
  } catch {
    return null;
  }
}

export async function getTenantCompletenessScore(
  tenantId: string
): Promise<TenantCompletenessScore | null> {
  const live = await getTenantCompletenessScoreRpc(tenantId);
  if (live) return live;
  const missing = await rpcIsMissing("tenant_completeness_score", { p_tenant_id: tenantId });
  if (!missing) return null;
  const tenant = await loadScoreTenant(tenantId);
  if (!tenant) return null;
  return scoreCaptureTenant(tenant);
}

export async function getTenantHoldGate(tenantId: string): Promise<TenantHoldGate | null> {
  const live = await getTenantHoldGateRpc(tenantId);
  if (live && !live.reasons.includes("provenance_rpc_missing")) return live;
  const missing = await rpcIsMissing("tenant_hold_gate", { p_tenant_id: tenantId });
  if (!missing && live) return live;
  if (!missing) return null;
  const tenant = await loadScoreTenant(tenantId);
  if (!tenant) return null;
  return holdCaptureTenant(tenant);
}

const POLICY_PATH = /^policies\.(payment|deposit|returns|delivery|cancellation|warranty|other)$/;

/** Writes owner on the JSON row so the compiler can read the confirm. */
export async function persistOwnerConfirm(
  client: SupabaseClient,
  tenantId: string,
  fieldPath: string
): Promise<boolean> {
  const product = fieldPath.match(/^catalog\.product\.(.+)\.name$/);
  const service = fieldPath.match(/^catalog\.service\.(\d+)\.name$/);
  const faq = fieldPath.match(/^faqs\.(\d+)/);
  const policy = fieldPath.match(POLICY_PATH);
  if (!product && !service && !faq && !policy) return false;

  const { data, error } = await client
    .from("tenants")
    .select("product_catalog, services_catalog, faqs, business_policies")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return false;

  const patch: Record<string, unknown> = {};
  if (product) {
    const key = product[1];
    const rows = Array.isArray(data.product_catalog) ? data.product_catalog : [];
    let hit = false;
    patch.product_catalog = rows.map((row: Record<string, unknown>, index: number) => {
      const sku = String(row?.sku || "").trim() || String(index + 1);
      if (sku !== key && String(index + 1) !== key) return row;
      hit = true;
      return { ...row, source: "owner" };
    });
    if (!hit) return false;
  } else if (service) {
    const index = Number(service[1]) - 1;
    const rows = Array.isArray(data.services_catalog) ? [...data.services_catalog] : [];
    const row = rows[index];
    if (!row || typeof row !== "object") return false;
    rows[index] = { ...(row as Record<string, unknown>), source: "owner" };
    patch.services_catalog = rows;
  } else if (faq) {
    const index = Number(faq[1]) - 1;
    const rows = Array.isArray(data.faqs) ? [...data.faqs] : [];
    const row = rows[index];
    if (!row || typeof row !== "object") return false;
    const prevStatus = String((row as Record<string, unknown>).status || "").toLowerCase();
    rows[index] = {
      ...(row as Record<string, unknown>),
      source: "owner",
      status: prevStatus === "golden" ? "golden" : "confirmed",
      confirmed: true,
    };
    patch.faqs = rows;
  } else if (policy) {
    const key = policy[1];
    const current =
      data.business_policies &&
      typeof data.business_policies === "object" &&
      !Array.isArray(data.business_policies)
        ? (data.business_policies as Record<string, unknown>)
        : {};
    const prev =
      current.provenance && typeof current.provenance === "object" && !Array.isArray(current.provenance)
        ? (current.provenance as Record<string, unknown>)
        : {};
    patch.business_policies = {
      ...current,
      provenance: {
        ...prev,
        [key]: { source: "owner", confirmed: true },
      },
    };
  }

  const updated = await client.from("tenants").update(patch).eq("id", tenantId);
  return !updated.error;
}

export async function confirmTenantField(input: {
  tenantId: string;
  fieldPath: string;
  userId?: string | null;
}) {
  const result = await confirmTenantFieldRpc(input);
  if (!result.error || !isMissingRpc(result.error)) return result;
  const supabase = await createSupabaseServerClient();
  const patched = await persistOwnerConfirm(supabase, input.tenantId, input.fieldPath);
  if (!patched) return result;
  return {
    data: { field_path: input.fieldPath, source: "owner" },
    error: null,
  };
}
