"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { parseLeadStatus, type LeadStatus } from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";

export type LeadStatusResult = {
  ok?: boolean;
  error?: string;
  leadStatus?: LeadStatus;
};

export async function updateLeadStatus(
  callId: string,
  nextStatus: string
): Promise<LeadStatusResult> {
  if (!(await isAuthenticated())) {
    return { error: "Not signed in." };
  }

  const status = parseLeadStatus(nextStatus);
  if (!callId) return { error: "Missing call id." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { error } = await workspace.client
    .from("calls")
    .update({ lead_status: status })
    .eq("id", callId)
    .eq("tenant_id", tenant.id);

  if (error) {
    const fallback =
      status === "archived" ? "Could not archive." : "Could not save.";
    return ownerSaveFailed("lead-status", error.message, fallback);
  }

  revalidatePath("/home");
  revalidatePath("/calls");
  revalidatePath(`/calls/${callId}`);
  return { ok: true, leadStatus: status };
}
