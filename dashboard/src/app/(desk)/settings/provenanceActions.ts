"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser, isAuthenticated } from "@/lib/auth";
import { confirmTenantField, persistOwnerConfirm, upsertTenantFieldMeta } from "@/lib/provenance";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

const PATH_OK =
  /^(catalog\.product\..+\.name|catalog\.service\.\d+\.name|faqs\.\d+|policies\.(payment|deposit|returns|delivery|cancellation|warranty|other))$/;

function cleanPaths(fieldPaths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fieldPaths) {
    const path = String(raw || "").trim();
    if (!PATH_OK.test(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= 80) break;
  }
  return out;
}

/** Tap to confirm. Calls confirm_tenant_field and stamps the JSON the compiler reads. */
export async function confirmCaptureFields(fieldPaths: string[]): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isAuthenticated())) return { error: "Sign in to confirm." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const user = await getAuthUser();
  const paths = cleanPaths(fieldPaths);
  if (!paths.length) return { ok: true };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  for (const fieldPath of paths) {
    await confirmTenantField({
      tenantId: tenant.id,
      fieldPath,
      userId: user?.id ?? null,
    });
    await persistOwnerConfirm(workspace.client, tenant.id, fieldPath);
  }

  revalidatePath("/settings");
  revalidatePath("/home");
  return { ok: true };
}

/** Owner edits. Best-effort meta write. The saved JSON already carries source. */
export async function stampOwnerFieldPaths(tenantId: string, fieldPaths: string[]): Promise<void> {
  const paths = cleanPaths(fieldPaths);
  for (const fieldPath of paths) {
    try {
      await upsertTenantFieldMeta({
        tenantId,
        fieldPath,
        source: "owner",
        actor: "desk",
      });
    } catch {
      /* RPC may be absent on a local database */
    }
  }
}
