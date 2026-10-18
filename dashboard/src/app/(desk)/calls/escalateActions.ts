"use server";

import { memberDenied } from "@/lib/requireMember";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { formatEscalationDelivery } from "@/lib/escalationDelivery";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { getVoicePublicBase } from "@/lib/sautikit";
import { parseSummary } from "@/lib/supabase";
import { normalizeTeamDirectory } from "@/lib/teamNotify";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { outboundSendBlock } from "@/lib/tenantLine";
import { escalateRefusalMessage, pingBlockMessage } from "@/lib/tenantLineState";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PingTeammateResult = {
  ok?: boolean;
  error?: string;
  line?: string;
  failed?: boolean;
};

function escalatePeople(
  team: unknown,
  ownerPhone?: string | null
) {
  return normalizeTeamDirectory(team, { ownerPhone: ownerPhone || undefined }).filter(
    (row) =>
      row.receives_escalation === true &&
      Boolean(String(row.phone || "").trim() || String(row.email || "").trim())
  );
}

export async function pingTeammateAction(opts: {
  callId: string;
  teammateName: string;
}): Promise<PingTeammateResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return denied;
  if (!(await isAuthenticated())) {
    return { error: "Not signed in." };
  }

  const callId = String(opts.callId || "").trim();
  const teammateName = String(opts.teammateName || "").trim();
  if (!callId) return { error: "Missing call." };
  if (!teammateName) return { error: "Pick a teammate." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const allowed = escalatePeople(
    tenant.team_directory,
    tenant.whatsapp_notification_number
  );
  const teammate = allowed.find(
    (row) => row.name.toLowerCase() === teammateName.toLowerCase()
  );
  if (!teammate) {
    return { error: "Escalate is off for that person." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  // Paused or closed line: no ping goes out and nothing is recorded.
  const blocked = await outboundSendBlock(workspace.client, tenant.id);
  if (blocked) return { error: pingBlockMessage(blocked) };

  const { data: call, error: loadError } = await workspace.client
    .from("calls")
    .select("id, sautikit_call_sid, summary, resolution_note")
    .eq("id", callId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (loadError) {
    return ownerSaveFailed("ping-teammate", loadError.message, "Could not send the alert.");
  }
  if (!call) return { error: "Missing call." };

  const callSid = String(call.sautikit_call_sid || "").trim();
  if (!callSid) {
    return persistNotifyFailed(workspace.client, tenant.id, callId, call.resolution_note);
  }

  const meta = parseSummary(typeof call.summary === "string" ? call.summary : null);
  const callerName = typeof meta.name === "string" ? meta.name : "";
  const reason =
    (typeof meta.escalate_reason === "string" && meta.escalate_reason.trim()) ||
    (typeof meta.reason === "string" && meta.reason.trim()) ||
    "Desk ping";

  const base = getVoicePublicBase();
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();
  let url: string;
  try {
    url = new URL("/internal/desk/escalate", `${base}/`).toString();
  } catch {
    return persistNotifyFailed(workspace.client, tenant.id, callId, call.resolution_note);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-voice-internal-secret": secret } : {}),
      },
      body: JSON.stringify({
        callSid,
        teammate: teammate.name,
        callerName,
        reason,
        force: true,
        pingId: crypto.randomUUID(),
        language: "en",
      }),
      cache: "no-store",
      // Never hold the Alert button open on a slow voice server.
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; reason?: string; escalation_notify?: Record<string, unknown> }
      | null;
    revalidatePath(`/calls/${callId}`);

    // Voice refused because the line is paused or the business is closed (409). Not a retry.
    const refused = escalateRefusalMessage(json);
    if (refused) return { error: refused };

    if (String(json?.reason || "") === "instance_already_sent") {
      return { ok: true, line: "Already pinged this ticket." };
    }

    if (!res.ok || !json?.ok) {
      const delivery = formatEscalationDelivery({
        escalated_to: { name: teammate.name, role: teammate.role, phone: teammate.phone },
        escalation_notify: json?.escalation_notify || { ok: false, stage: "failed" },
      });
      return {
        failed: true,
        line: delivery.line || "Notification retry pending",
        error: "Notification retry pending",
      };
    }

    const delivery = formatEscalationDelivery(
      {
        escalated_to: { name: teammate.name, role: teammate.role, phone: teammate.phone },
        escalation_notify: json.escalation_notify,
      },
      { fromDesk: true }
    );
    return {
      ok: true,
      line: delivery.line || undefined,
      failed: delivery.state === "failed",
    };
  } catch (err) {
    // Timed out: the alert may still go out, so do not record it as failed.
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      console.warn(`[ping-teammate] voice line slow for call ${callId}; not marking failed`);
      return {
        failed: true,
        line: "Still sending. Check this call again in a minute.",
        error: "Still sending. Check this call again in a minute.",
      };
    }
    return persistNotifyFailed(workspace.client, tenant.id, callId, call.resolution_note);
  }
}

async function persistNotifyFailed(
  client: SupabaseClient,
  tenantId: string,
  callId: string,
  existingNote: string | null
): Promise<PingTeammateResult> {
  const note = "Needs human. Notify failed.";
  const cur = String(existingNote || "").trim();
  const next = cur.includes(note) ? cur : cur ? `${cur}. ${note}` : note;
  const { error } = await client
    .from("calls")
    .update({ resolution_note: next })
    .eq("id", callId)
    .eq("tenant_id", tenantId);
  if (error) {
    return ownerSaveFailed("ping-teammate", error.message, note);
  }
  revalidatePath(`/calls/${callId}`);
  return { failed: true, line: "Notification retry pending", error: "Notification retry pending" };
}
