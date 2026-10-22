"use server";

import { memberDenied } from "@/lib/requireMember";

import { revalidatePath } from "next/cache";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import { renderDeskCallerText } from "@/lib/callerSms";
import { sendRecordedDeskCallerSms } from "@/lib/sendLedger";
import { stampScheduleWindows } from "@/lib/visitCalendar";

export type AppointmentStatusState = {
  error?: string;
  ok?: boolean;
  /** Saved, but the caller text did not go out (line paused or business closed). */
  notice?: string;
};

const STATUSES = new Set(["requested", "confirmed", "cancelled", "done"]);

export async function updateAppointmentStatus(
  _prev: AppointmentStatusState,
  formData: FormData
): Promise<AppointmentStatusState> {
  const denied = await memberDenied("inbox.act");
  if (denied) return denied;
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
    .select("caller_phone, caller_name, service_name, when_text, call_id")
    .maybeSingle();

  if (error) {
    return ownerSaveFailed("appointment-status", error.message, "Could not save appointment.");
  }

  let notice: string | undefined;
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
    const sent = await sendRecordedDeskCallerSms({
      client: workspace.client,
      tenantId: tenant.id,
      callId: row.call_id,
      kind:
        status === "cancelled"
          ? "caller_appointment_cancelled"
          : "caller_appointment_confirmed",
      to: row.caller_phone,
      body,
      appointmentId: id || null,
    });
    if (!sent.ok) console.warn("[appointment caller sms]", sent.reason);
    if (sent.message) notice = sent.message;
  }

  revalidatePath("/appointments");
  revalidatePath("/calls");
  revalidatePath("/home");
  return notice ? { ok: true, notice } : { ok: true };
}

export type AppointmentScheduleState = {
  error?: string;
  ok?: boolean;
  /** Saved, but the caller text did not go out (line paused or business closed). */
  notice?: string;
};

export async function updateAppointmentSchedule(
  _prev: AppointmentScheduleState,
  formData: FormData
): Promise<AppointmentScheduleState> {
  const denied = await memberDenied("inbox.act");
  if (denied) return denied;
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

  const windows = stampScheduleWindows(whenText);
  const { data: row, error } = await workspace.client
    .from("appointments")
    .update({
      when_text: windows.when_text,
      window_start: windows.window_start,
      window_end: windows.window_end,
      address_landmark: landmark || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .select("caller_phone, caller_name, service_name, when_text, call_id")
    .maybeSingle();

  if (error) {
    return ownerSaveFailed("appointment-when", error.message, "Could not save appointment.");
  }

  const whenChanged = String(existing?.when_text || "").trim() !== whenText;
  let notice: string | undefined;
  const prefs = parseNotifyChannels(tenant.notify_channels);
  if (prefs.caller_sms && row?.caller_phone && whenChanged) {
    const body = renderDeskCallerText({
      kind: "caller_appointment_rescheduled",
      businessName: tenant.business_name,
      callerName: row.caller_name,
      service: row.service_name,
      when: row.when_text,
    });
    const sent = await sendRecordedDeskCallerSms({
      client: workspace.client,
      tenantId: tenant.id,
      callId: row.call_id,
      kind: "caller_appointment_rescheduled",
      to: row.caller_phone,
      body,
      appointmentId: id || null,
    });
    if (!sent.ok) console.warn("[appointment caller sms]", sent.reason);
    if (sent.message) notice = sent.message;
  }

  revalidatePath("/appointments");
  revalidatePath("/calls");
  revalidatePath("/home");
  if (row?.call_id) revalidatePath(`/calls/${row.call_id}`);
  return notice ? { ok: true, notice } : { ok: true };
}
