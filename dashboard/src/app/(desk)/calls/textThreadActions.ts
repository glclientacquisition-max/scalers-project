"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import { sendRecordedDeskCallerSms } from "@/lib/sendLedger";
import { isCallMessagesRpcMissing, loadCallMessages } from "@/lib/callMessages";
import { deskSmsSendError } from "@/lib/deskSmsError";

export type RetryCallTextResult = { ok?: boolean; error?: string };

/**
 * Retry one failed or refused text on a call's thread: call_messages_retry
 * makes the new row and key (original key + ":retry"), then the send goes
 * through the same reserve, send, settle path with that key. The thread row
 * already exists, so nothing is recorded twice.
 */
export async function retryCallTextAction(callId: string, messageId: string): Promise<RetryCallTextResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return { error: denied.error };
  const call = String(callId || "").trim();
  const message = String(messageId || "").trim();
  if (!call || !message) return { error: "Text not found." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };
  if (!parseNotifyChannels(tenant.notify_channels).caller_sms) {
    return { error: "Turn on Text customers in Business." };
  }
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const [thread, callRes] = await Promise.all([
    loadCallMessages(workspace.client, tenant.id, call),
    workspace.client
      .from("calls")
      .select("caller_number")
      .eq("id", call)
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
  ]);
  const original = thread.messages.find((m) => m.id === message);
  if (!thread.available || !original) return { error: "Text not found." };
  const to = String(callRes.data?.caller_number || "").trim();
  if (!to) return { error: "No customer number." };

  const { data, error } = await workspace.client.rpc("call_messages_retry", {
    p_tenant_id: tenant.id,
    p_message_id: message,
  });
  if (error) {
    if (isCallMessagesRpcMissing(error)) return { error: "Retry is unavailable." };
    if (error.code === "23505") return { error: "Already retried." };
    if (error.code === "42501") return { error: "You cannot send texts here." };
    if (error.code === "22023") return { error: "This text cannot be retried." };
    console.warn("[call messages] retry", error.code, error.message);
    return { error: "Retry failed." };
  }
  const key = String((data as { idempotency_key?: unknown } | null)?.idempotency_key || "").trim();
  if (!key) return { error: "Retry failed." };

  const sent = await sendRecordedDeskCallerSms({
    client: workspace.client,
    tenantId: tenant.id,
    callId: call,
    kind: original.source,
    to,
    body: original.body,
    key,
    recordThread: false,
  });
  revalidatePath(`/calls/${call}`);
  if (!sent.ok) return { error: deskSmsSendError(sent) };
  return { ok: true };
}
