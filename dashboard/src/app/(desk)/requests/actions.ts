"use server";

import { revalidatePath } from "next/cache";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import { renderDeskCallerText, sendDeskCallerSms } from "@/lib/callerSms";

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
  revalidatePath("/calls");
  revalidatePath("/home");
  return { ok: true };
}

export type RequestScheduleState = {
  error?: string;
  ok?: boolean;
};

export async function updateServiceRequestSchedule(
  _prev: RequestScheduleState,
  formData: FormData
): Promise<RequestScheduleState> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };

  const id = String(formData.get("id") || "").trim();
  const whenText = String(formData.get("when_text") || "").trim().slice(0, 120);
  if (!id) return { error: "Missing request." };
  if (!whenText) return { error: "Set a time." };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { data: existing } = await workspace.client
    .from("service_requests")
    .select("when_text, caller_phone, caller_name, item, request_type, call_id")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  const { data: row, error } = await workspace.client
    .from("service_requests")
    .update({
      when_text: whenText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .select("caller_phone, caller_name, item, request_type, when_text, call_id")
    .maybeSingle();

  if (error) {
    if (/service_requests|relation/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`,
      };
    }
    return { error: error.message };
  }

  const whenChanged = String(existing?.when_text || "").trim() !== whenText;
  const prefs = parseNotifyChannels(tenant.notify_channels);
  const type = String(row?.request_type || "").toLowerCase();
  if (
    prefs.caller_sms &&
    row?.caller_phone &&
    whenChanged &&
    (type === "hold" || type === "order" || type === "callback")
  ) {
    const body = renderDeskCallerText({
      kind: "caller_hold_updated",
      businessName: tenant.business_name,
      callerName: row.caller_name,
      service: row.item,
      when: row.when_text,
    });
    const sent = await sendDeskCallerSms({ to: row.caller_phone, body });
    if (!sent.ok) {
      console.warn("[request caller sms]", sent.reason);
    }
  }

  revalidatePath("/requests");
  revalidatePath("/calls");
  revalidatePath("/home");
  if (row?.call_id) revalidatePath(`/calls/${row.call_id}`);
  return { ok: true };
}
