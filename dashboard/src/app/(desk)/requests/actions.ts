"use server";

import { revalidatePath } from "next/cache";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type RequestStatusState = {
  error?: string;
  ok?: boolean;
};

export async function updateServiceRequestStatus(
  _prev: RequestStatusState,
  formData: FormData
): Promise<RequestStatusState> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };

  const id = String(formData.get("id") || "").trim();
  const status = String(formData.get("status") || "")
    .trim()
    .toLowerCase();
  if (!id) return { error: "Missing request." };
  if (!["open", "fulfilled", "cancelled"].includes(status)) {
    return { error: "Invalid status." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { error } = await workspace.client
    .from("service_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenant.id);

  if (error) {
    if (/service_requests|relation/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/requests");
  return { ok: true };
}
