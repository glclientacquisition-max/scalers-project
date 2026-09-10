"use server";

import { revalidatePath } from "next/cache";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import { renderDeskCallerText, sendDeskCallerSms } from "@/lib/callerSms";

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

  const { data: row, error } = await workspace.client
    .from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .select("caller_phone, caller_name, service_name, when_text")
    .maybeSingle();

  if (error) {
    if (/appointments|relation/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/appointments.sql in Supabase.`,
      };
    }
    return { error: error.message };
  }

  const prefs = parseNotifyChannels(tenant.notify_channels);
  if (
    prefs.caller_sms &&
    row?.caller_phone &&
    (status === "confirmed" || status === "cancelled")
  ) {
    const body = renderDeskCallerText({
      kind:
        status === "cancelled"
          ? "caller_appointment_cancelled"
          : "caller_appointment_confirmed",
      businessName: tenant.business_name,
      callerName: row.caller_name,
      service: row.service_name,
      when: row.when_text,
    });
    const sent = await sendDeskCallerSms({ to: row.caller_phone, body });
    if (!sent.ok) {
      console.warn("[appointment caller sms]", sent.reason);
    }
  }

  revalidatePath("/appointments");
  revalidatePath("/calls");
  revalidatePath("/home");
  return { ok: true };
}

export type AppointmentScheduleState = {
  error?: string;
  ok?: boolean;
};

export async function updateAppointmentSchedule(
  _prev: AppointmentScheduleState,
  formData: FormData
): Promise<AppointmentScheduleState> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };

  const id = String(formData.get("id") || "").trim();
  const whenText = String(formData.get("when_text") || "").trim().slice(0, 120);
  const landmark = String(formData.get("address_landmark") || "")
    .trim()
    .slice(0, 120);
  if (!id) return { error: "Missing appointment." };
  if (!whenText) return { error: "Set a time." };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { data: existing } = await workspace.client
    .from("appointments")
    .select("when_text, address_landmark, caller_phone, caller_name, service_name, call_id")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  const { data: row, error } = await workspace.client
    .from("appointments")
    .update({
      when_text: whenText,
      address_landmark: landmark || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .select("caller_phone, caller_name, service_name, when_text, call_id")
    .maybeSingle();

  if (error) {
    if (/appointments|relation/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/appointments.sql in Supabase.`,
      };
    }
    return { error: error.message };
  }

  const whenChanged = String(existing?.when_text || "").trim() !== whenText;
  const prefs = parseNotifyChannels(tenant.notify_channels);
  if (prefs.caller_sms && row?.caller_phone && whenChanged) {
    const body = renderDeskCallerText({
      kind: "caller_appointment_rescheduled",
      businessName: tenant.business_name,
      callerName: row.caller_name,
      service: row.service_name,
      when: row.when_text,
    });
    const sent = await sendDeskCallerSms({ to: row.caller_phone, body });
    if (!sent.ok) {
      console.warn("[appointment caller sms]", sent.reason);
    }
  }

  revalidatePath("/appointments");
  revalidatePath("/calls");
  revalidatePath("/home");
  if (row?.call_id) revalidatePath(`/calls/${row.call_id}`);
  return { ok: true };
}
