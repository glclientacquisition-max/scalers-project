"use server";

import { revalidatePath } from "next/cache";
import { generateGeminiText } from "@/lib/gemini";
import {
  fallbackPolishCallerNote,
  POLISH_CALLER_SMS_SYSTEM,
  stripModelSms,
} from "@/lib/polishCallerNote";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import { sendDeskCallerSms } from "@/lib/callerSms";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { parseSummary } from "@/lib/supabase";

export type PolishCallerNoteState = {
  error?: string;
  text?: string;
  source?: "gemini" | "local";
};

export async function polishCallerNoteAction(
  _prev: PolishCallerNoteState,
  formData: FormData
): Promise<PolishCallerNoteState> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };

  const note = String(formData.get("note") || "").trim();
  if (!note) return { error: "Write a note." };

  const facts = {
    note,
    businessName: tenant.business_name,
    callerName: String(formData.get("caller_name") || "").trim() || null,
    service: String(formData.get("service") || "").trim() || null,
    when: String(formData.get("when") || "").trim() || null,
    landmark: String(formData.get("landmark") || "").trim() || null,
  };

  const userText = [
    `Business: ${facts.businessName}`,
    facts.callerName ? `Customer name: ${facts.callerName}` : null,
    facts.service ? `Service or item: ${facts.service}` : null,
    facts.when ? `When: ${facts.when}` : null,
    facts.landmark ? `Where: ${facts.landmark}` : null,
    `Owner note: ${facts.note}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await generateGeminiText({
      systemInstruction: POLISH_CALLER_SMS_SYSTEM,
      userText,
      temperature: 0.2,
      maxOutputTokens: 256,
      timeoutMs: 8000,
    });
    const text = stripModelSms(raw);
    if (text) return { text, source: "gemini" };
  } catch (err) {
    console.warn("[polishCallerNote]", err instanceof Error ? err.message : err);
  }

  return { text: fallbackPolishCallerNote(facts), source: "local" };
}

export type SendCallerNoteState = {
  error?: string;
  ok?: boolean;
};

export async function sendCallerNoteAction(
  _prev: SendCallerNoteState,
  formData: FormData
): Promise<SendCallerNoteState> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };

  const prefs = parseNotifyChannels(tenant.notify_channels);
  if (!prefs.caller_sms) {
    return { error: "Turn on Text customers in Business." };
  }

  const phone = String(formData.get("caller_phone") || "").trim();
  const body = String(formData.get("note") || "").trim().slice(0, 320);
  const callId = String(formData.get("call_id") || "").trim();
  if (!phone) return { error: "No customer number." };
  if (!body) return { error: "Write a note." };

  const sent = await sendDeskCallerSms({ to: phone, body });
  if (!sent.ok) {
    return { error: sent.reason === "sms_not_configured" ? "SMS is not configured." : "SMS failed." };
  }

  if (callId) {
    const workspace = await createWorkspaceDataClient();
    if (workspace) {
      const { data: row } = await workspace.client
        .from("calls")
        .select("summary")
        .eq("id", callId)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      const raw = row?.summary as unknown;
      const meta =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : parseSummary(typeof raw === "string" ? raw : null);
      const next = {
        ...meta,
        caller_reply_body: body,
        caller_reply_at: new Date().toISOString(),
      };
      const { error: sumErr } = await workspace.client
        .from("calls")
        .update({ summary: JSON.stringify(next) })
        .eq("id", callId)
        .eq("tenant_id", tenant.id);
      if (sumErr) {
        console.warn("[caller note summary]", sumErr.message);
      }
      revalidatePath(`/calls/${callId}`);
    }
  }

  revalidatePath("/calls");
  return { ok: true };
}
