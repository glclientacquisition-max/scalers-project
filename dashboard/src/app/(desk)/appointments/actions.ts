"use server";

import { revalidatePath } from "next/cache";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type AppointmentStatusState = {
  error?: string;
  ok?: boolean;
};

const STATUSES = new Set(["requested", "confirmed", "cancelled", "done"]);

export async function updateAppointmentStatus(
  _prev: AppointmentStatusState,
  formData: FormData
): Promise<AppointmentStatusState> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };

  const id = String(formData.get("id") || "").trim();
  const status = String(formData.get("status") || "")
    .trim()
    .toLowerCase();
  if (!id) return { error: "Missing appointment." };
  if (!STATUSES.has(status)) {
    return { error: "Invalid status." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { error } = await workspace.client
    .from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenant.id);

  if (error) {
    if (/appointments|relation/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/appointments.sql in Supabase.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/appointments");
  return { ok: true };
}
