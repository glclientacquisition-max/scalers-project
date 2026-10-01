"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { parseNotifyChannelsField } from "@/lib/notifyChannels";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { alertPhoneWrite, alertsPersistMatchesSubmit } from "@/lib/alertsSave";
import { ownerSaveFailed } from "@/lib/ownerFacingError";

export type AlertsActionState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

export async function saveAlertsAction(
  _prev: AlertsActionState,
  formData: FormData
): Promise<AlertsActionState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to save settings." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const tenantIdCheck = String(formData.get("tenant_id") || "").trim();
  if (!tenantIdCheck || tenantIdCheck !== tenant.id) {
    return { error: "Forbidden." };
  }

  const submittedPhone = String(
    formData.get("whatsapp_notification_number") || ""
  ).trim();
  const submittedEmail = String(formData.get("alert_email") || "")
    .trim()
    .toLowerCase();
  const notifyChannels = parseNotifyChannelsField(formData.get("notify_channels"));
  const writtenPhone = alertPhoneWrite(submittedPhone);
  const writtenEmail = submittedEmail || null;

  if (submittedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)) {
    return { error: "Alert email looks invalid." };
  }

  if (
    !alertsPersistMatchesSubmit({
      submittedPhone,
      writtenPhone,
      submittedEmail,
      writtenEmail,
    })
  ) {
    return { error: "Alert contact was not saved." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { error } = await workspace.client
    .from("tenants")
    .update({
      whatsapp_notification_number: writtenPhone,
      alert_email: writtenEmail,
      notify_channels: notifyChannels,
    })
    .eq("id", tenant.id);

  if (error) {
    return ownerSaveFailed("alerts.save", error.message);
  }

  revalidatePath("/settings");
  return { ok: true, message: "Saved" };
}
