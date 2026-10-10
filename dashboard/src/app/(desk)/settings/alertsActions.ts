"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser, isAuthenticated } from "@/lib/auth";
import { parseNotifyChannelsField } from "@/lib/notifyChannels";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { alertPhoneWrite, alertsPersistMatchesSubmit } from "@/lib/alertsSave";
import { validateAlertsSave } from "@/lib/contactValidation";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { fieldPathsAttestedOnAlertsSave } from "@/lib/fieldPathsFromSettingsSave";
import { ownerAttestFields } from "@/lib/ownerAttestFields";

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
  const submittedChannels = parseNotifyChannelsField(formData.get("notify_channels"));
  const checked = validateAlertsSave({
    phone: submittedPhone,
    email: submittedEmail,
    channels: submittedChannels,
  });
  if (!checked.ok) return { error: checked.error };
  const notifyChannels = checked.channels;
  // Stored as E.164 (+2547...), so compare against the normalized submit.
  const writtenPhone = alertPhoneWrite(checked.phone);
  const writtenEmail = checked.email;

  if (
    !alertsPersistMatchesSubmit({
      submittedPhone: checked.phone,
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

  const user = await getAuthUser();
  await ownerAttestFields(
    tenant.id,
    fieldPathsAttestedOnAlertsSave({
      whatsappNumber: writtenPhone,
      alertEmail: writtenEmail,
      hasNotifyChannels: Object.keys(notifyChannels || {}).length > 0,
    }),
    user?.id ?? null
  );

  revalidatePath("/settings");
  return { ok: true, message: checked.note || "Saved" };
}
