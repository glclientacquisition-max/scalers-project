import "server-only";

import { revalidatePath } from "next/cache";
import { cleanFieldPaths, isKnownFieldPath } from "@/lib/fieldPathRegistry";
import { bustTenantCache } from "@/lib/tenantCache";
import { runOwnerAttest } from "@/lib/ownerAttestBatch";
import {
  confirmTenantField as confirmTenantFieldRpc,
  confirmTenantFieldsBatch,
  reopenTenantField,
  upsertTenantFieldMeta,
} from "@/lib/tenantFieldProvenance";
import { validConfirmBatch, type FactConfirmPlan } from "@/lib/factConfirm";
import { createWorkspaceDataClient } from "@/lib/tenant";
import { FACT_ROW_COLUMNS, FACT_ROW_CORE_COLUMNS } from "@/lib/factRowColumns";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The old per-path meta confirm. Only runs when the batch RPC fails. */
async function confirmOneLegacy(tenantId: string, fieldPath: string, userId: string | null): Promise<void> {
  const confirm = await confirmTenantFieldRpc({ tenantId, fieldPath, userId });
  if (confirm.error) {
    await upsertTenantFieldMeta({
      tenantId,
      fieldPath,
      source: "owner",
      actor: "desk",
    });
  }
}

/**
 * Mark field paths as owner-confirmed (meta + JSON rows where applicable).
 * Settings Save is the owner approval step — call after every successful save.
 *
 * Fixed round trips, not per path (runOwnerAttest): one saved-row read, one
 * tenants update stamping every JSON row, one confirm_tenant_fields batch.
 */
export async function ownerAttestFields(
  tenantId: string,
  fieldPaths: string[],
  userId: string | null
): Promise<void> {
  if (!tenantId) return;
  const paths = cleanFieldPaths(fieldPaths);
  if (!paths.length) return;

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return;
  const client = workspace.client;

  await runOwnerAttest(
    {
      readRow: () => readSavedFactRow(client, tenantId),
      writePatch: async (patch) => {
        const { error } = await client.from("tenants").update(patch).eq("id", tenantId);
        bustTenantCache(tenantId);
        if (error) console.warn("[ownerAttestFields] owner stamp", error.message);
        return { error };
      },
      confirmBatch: async (batchPaths, hashes) => {
        const { error } = await confirmTenantFieldsBatch({ tenantId, paths: batchPaths, hashes });
        if (error) console.warn("[ownerAttestFields] confirm_tenant_fields, per-path fallback", error.message);
        return { error };
      },
      confirmOne: (fieldPath) => confirmOneLegacy(tenantId, fieldPath, userId),
    },
    paths
  );

  revalidatePath("/settings");
  revalidatePath("/home");
}

/**
 * Hash mode (FACT_HASH_MODE on): write a changed-only plan. One
 * confirm_tenant_fields batch for the confirms, then a reopen per cleared path.
 * No per-path fallback: without the v2 SQL nothing is confirmed, which is the
 * hash-mode reading of a missing value_hash anyway.
 */
export async function ownerConfirmPlan(tenantId: string, plan: FactConfirmPlan): Promise<void> {
  if (!tenantId) return;
  // The P0 80-path cap (cleanFieldPaths) does not apply; the batch RPC caps at 500.
  const batch = {
    confirm: plan.confirm.filter(({ path }) => isKnownFieldPath(path)),
    reopen: [...new Set(plan.reopen.filter((path) => isKnownFieldPath(path)))],
  };
  if (!validConfirmBatch(batch)) {
    console.warn("[ownerConfirmPlan] invalid batch", batch.confirm.length);
    return;
  }
  if (batch.confirm.length) {
    const { error } = await confirmTenantFieldsBatch({
      tenantId,
      paths: batch.confirm.map((row) => row.path),
      hashes: batch.confirm.map((row) => row.hash),
    });
    if (error) console.warn("[ownerConfirmPlan] confirm_tenant_fields", error.message);
  }
  for (const fieldPath of batch.reopen) {
    const { error } = await reopenTenantField({ tenantId, fieldPath });
    if (error) console.warn("[ownerConfirmPlan] reopen_tenant_field", error.message);
  }
  if (batch.confirm.length || batch.reopen.length) {
    revalidatePath("/settings");
    revalidatePath("/home");
  }
}

/**
 * The stored fact columns (FACT_ROW_COLUMNS), read before a save for the diff
 * and after it so confirm hashes what was written. Null on a read error.
 */
export async function readSavedFactRow(
  client: SupabaseClient,
  tenantId: string
): Promise<Record<string, unknown> | null> {
  const read = (columns: string) =>
    client.from("tenants").select(columns).eq("id", tenantId).maybeSingle();
  let { data, error } = await read(FACT_ROW_COLUMNS);
  if (error?.code === "42703") {
    // An older database without an optional column: the core facts still confirm.
    console.warn("[readSavedFactRow] optional column missing, core columns only");
    ({ data, error } = await read(FACT_ROW_CORE_COLUMNS));
  }
  if (error || !data) {
    if (error) console.warn("[readSavedFactRow]", error.message);
    return null;
  }
  return data as unknown as Record<string, unknown>;
}
