import "server-only";

import { revalidatePath } from "next/cache";
import { cleanFieldPaths, isKnownFieldPath } from "@/lib/fieldPathRegistry";
import { confirmTenantField, persistOwnerConfirm } from "@/lib/deskProvenance";
import {
  confirmTenantFieldsBatch,
  reopenTenantField,
  upsertTenantFieldMeta,
} from "@/lib/tenantFieldProvenance";
import { validConfirmBatch, type FactConfirmPlan } from "@/lib/factConfirm";
import { createWorkspaceDataClient } from "@/lib/tenant";
import type { SupabaseClient } from "@supabase/supabase-js";

async function attestOne(
  client: SupabaseClient,
  tenantId: string,
  fieldPath: string,
  userId: string | null
): Promise<void> {
  const confirm = await confirmTenantField({
    tenantId,
    fieldPath,
    userId,
  });
  if (confirm.error) {
    await upsertTenantFieldMeta({
      tenantId,
      fieldPath,
      source: "owner",
      actor: "desk",
    });
  }
  await persistOwnerConfirm(client, tenantId, fieldPath);
}

/**
 * Mark field paths as owner-confirmed (meta + JSON rows where applicable).
 * Settings Save is the owner approval step — call after every successful save.
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

  for (const fieldPath of paths) {
    try {
      await attestOne(workspace.client, tenantId, fieldPath, userId);
    } catch {
      try {
        await upsertTenantFieldMeta({
          tenantId,
          fieldPath,
          source: "owner",
          actor: "desk",
        });
      } catch {
        /* local database without RPC */
      }
    }
  }

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

const FACT_ROW_COLUMNS =
  "business_name, vertical, spoken_name, social_handles, hours_schedule, business_locations, business_policies, agent_name, agent_tone, agent_tools, faqs, services_catalog, product_catalog";

/** The stored row after a save, so confirm hashes what was written. Null on a read error. */
export async function readSavedFactRow(
  client: SupabaseClient,
  tenantId: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("tenants")
    .select(FACT_ROW_COLUMNS)
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn("[readSavedFactRow]", error.message);
    return null;
  }
  return data as Record<string, unknown>;
}
