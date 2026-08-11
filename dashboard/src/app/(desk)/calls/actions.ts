"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { parseLeadStatus, type LeadStatus } from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

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
    if (/archived|lead_status.*check|check.*lead_status/i.test(error.message)) {
      return {
        error:
          "Archive needs a one-time database update. Apply docs/supabase/lead_status_archive.sql in Supabase.",
      };
    }
    if (/lead_status|column/i.test(error.message)) {
      return {
        error: "Lead statuses are not set up yet. Apply docs/supabase/lead_status.sql in Supabase.",
      };
    }
    if (/row-level security|permission denied|rls/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/lead_status.sql (owner update policy).`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/home");
  revalidatePath("/calls");
  revalidatePath(`/calls/${callId}`);
  return { ok: true, leadStatus: status };
}
