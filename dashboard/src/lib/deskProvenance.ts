import { bustTenantCache } from "@/lib/tenantCache";
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
  reconcileCatalogScore,
  scoreCaptureTenant,
  type ProvenanceMeta,
  type ScoreTenant,
} from "@/lib/completenessStub";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant";
import {
  confirmTenantField as confirmTenantFieldRpc,
  getTenantCompletenessScore as getTenantCompletenessScoreRpc,
  getTenantHoldGate as getTenantHoldGateRpc,
  listTenantFieldMeta,
  upsertTenantFieldMeta,
  type TenantCompletenessScore,
  type TenantHoldGate,
} from "@/lib/tenantFieldProvenance";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerStampApplies, ownerStampPatch } from "@/lib/ownerAttestBatch";

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
  if (live) {
    // Live SQL misses Settings-saved service prices (price_range); score the
    // catalogue from the real rows so Overview matches what the owner saved.
    try {
      const [tenant, metaRows] = await Promise.all([
        loadScoreTenant(tenantId),
        listTenantFieldMeta(tenantId),
      ]);
      if (!tenant) return live;
      const meta: ProvenanceMeta = {};
      for (const row of metaRows || []) {
        if (row?.field_path && row?.source) {
          meta[row.field_path] = row.source as ProvenanceMeta[string];
        }
      }
      return reconcileCatalogScore(live, tenant, meta);
    } catch {
      return live;
    }
  }
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

/**
 * Writes owner on the JSON row so the compiler can read the confirm. One path;
 * ownerAttestFields stamps a whole save in one update (ownerStampPatch).
 */
export async function persistOwnerConfirm(
  client: SupabaseClient,
  tenantId: string,
  fieldPath: string
): Promise<boolean> {
  if (!ownerStampApplies(fieldPath)) return false;

  const { data, error } = await client
    .from("tenants")
    .select("product_catalog, services_catalog, faqs, business_policies")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return false;

  const patch = ownerStampPatch(data as Record<string, unknown>, [fieldPath]);
  if (!patch) return false;

  const updated = await client.from("tenants").update(patch).eq("id", tenantId);
  bustTenantCache(tenantId);
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
