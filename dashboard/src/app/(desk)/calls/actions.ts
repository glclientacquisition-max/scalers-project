"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { parseLeadStatus, type LeadStatus } from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { appendWhatsAppFollowUpNote } from "@/lib/whatsappFollowUp";

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

export type WhatsAppFollowUpResult = LeadStatusResult & {
  note?: string;
};

/**
 * wa.me click write-back. Same pile close as Mark done (`lead_status = resolved`)
 * plus an owner-writable follow-up note. `contacted` stays on Needs you.
 */
export async function logWhatsAppFollowUp(
  callId: string
): Promise<WhatsAppFollowUpResult> {
  if (!(await isAuthenticated())) {
    return { error: "Not signed in." };
  }

  const id = String(callId || "").trim();
  if (!id) return { error: "Missing call id." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { data: row, error: loadError } = await workspace.client
    .from("calls")
    .select("lead_status, resolution_note")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (loadError) {
    return ownerSaveFailed("whatsapp-followup", loadError.message, "Could not save.");
  }
  if (!row) return { error: "Missing call." };

  const current = parseLeadStatus(row.lead_status);
  if (current === "archived") {
    return { ok: true, leadStatus: current };
  }

  const note = appendWhatsAppFollowUpNote(row.resolution_note);
  const { error } = await workspace.client
    .from("calls")
    .update({
      lead_status: "resolved",
      resolution_note: note,
    })
    .eq("id", id)
    .eq("tenant_id", tenant.id);

  if (error) {
    return ownerSaveFailed("whatsapp-followup", error.message, "Could not save.");
  }

  revalidatePath("/home");
  revalidatePath("/calls");
  revalidatePath(`/calls/${id}`);
  return { ok: true, leadStatus: "resolved", note };
}
