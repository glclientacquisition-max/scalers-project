"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { formatEscalationDelivery } from "@/lib/escalationDelivery";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { getVoicePublicBase } from "@/lib/sautikit";
import { parseSummary } from "@/lib/supabase";
import { normalizeTeamDirectory } from "@/lib/teamNotify";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
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

  const { data: call, error: loadError } = await workspace.client
    .from("calls")
    .select("id, sautikit_call_sid, summary, resolution_note")
    .eq("id", callId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (loadError) {
    return ownerSaveFailed("ping-teammate", loadError.message, "Could not ping.");
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
        language: "en",
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; reason?: string; escalation_notify?: Record<string, unknown> }
      | null;
    revalidatePath(`/calls/${callId}`);

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
        line: delivery.line || "Needs human. Notify failed.",
        error: json?.reason || "Needs human. Notify failed.",
      };
    }

    const delivery = formatEscalationDelivery({
      escalated_to: { name: teammate.name, role: teammate.role, phone: teammate.phone },
      escalation_notify: json.escalation_notify,
    });
    return {
      ok: true,
      line: delivery.line || undefined,
      failed: delivery.state === "failed",
    };
  } catch {
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
  return { failed: true, line: note, error: note };
}
