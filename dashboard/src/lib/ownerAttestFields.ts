import "server-only";

import { revalidatePath } from "next/cache";
import { cleanFieldPaths } from "@/lib/fieldPathRegistry";
import { confirmTenantField, persistOwnerConfirm } from "@/lib/deskProvenance";
import { upsertTenantFieldMeta } from "@/lib/tenantFieldProvenance";
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
