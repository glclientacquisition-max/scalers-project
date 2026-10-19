"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient } from "@/lib/tenant";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markBillingNoticeRead(id: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await memberDenied("billing.manage");
  if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: "Could not update that notice." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { ok: false, error: "Sign in to continue." };
  const { error } = await workspace.client.rpc("mark_billing_notice_read", { p_id: id });
  if (error) return { ok: false, error: "Could not update that notice." };
  revalidatePath("/settings/billing");
  return { ok: true };
}
