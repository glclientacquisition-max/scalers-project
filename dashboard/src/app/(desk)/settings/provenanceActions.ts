"use server";

import { getAuthUser, isAuthenticated } from "@/lib/auth";
import { cleanFieldPaths } from "@/lib/fieldPathRegistry";
import { ownerAttestFields } from "@/lib/ownerAttestFields";
import { getCurrentTenant } from "@/lib/tenant";

/** Tap to confirm. Calls confirm_tenant_field and stamps the JSON the compiler reads. */
export async function confirmCaptureFields(fieldPaths: string[]): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isAuthenticated())) return { error: "Sign in to confirm." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const user = await getAuthUser();
  const paths = cleanFieldPaths(fieldPaths);
  if (!paths.length) return { ok: true };

  await ownerAttestFields(tenant.id, paths, user?.id ?? null);
  return { ok: true };
}

/** Owner edits from hidden form field. Prefer ownerAttestFields on save. */
export async function stampOwnerFieldPaths(tenantId: string, fieldPaths: string[]): Promise<void> {
  const paths = cleanFieldPaths(fieldPaths);
  if (!paths.length) return;
  await ownerAttestFields(tenantId, paths, null);
}
