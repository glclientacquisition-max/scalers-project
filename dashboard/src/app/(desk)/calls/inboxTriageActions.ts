"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import {
  inboxSnoozeUntilIso,
  inboxTeammateOptions,
  isInboxTeammateValue,
  parseInboxLabels,
  sanitizeInboxLabel,
} from "@/lib/inboxTriage";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type InboxTriageResult = {
  ok?: boolean;
  error?: string;
};

type InboxTriagePatch = {
  inbox_read_at?: string | null;
  inbox_muted?: boolean;
  inbox_pinned_at?: string | null;
  inbox_assignee?: string | null;
  inbox_labels?: string[];
  inbox_snoozed_until?: string | null;
};

async function loadWorkspace() {
  if (!(await isAuthenticated())) return null;
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return null;
  return { tenant, workspace };
}

function missingCall(): InboxTriageResult {
  return { error: "Missing call." };
}

async function writeInboxTriage(
  callId: string,
  patch: InboxTriagePatch,
  opts?: { revalidateTicket?: boolean }
): Promise<InboxTriageResult> {
  const id = String(callId || "").trim();
  if (!id) return missingCall();

  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };

  const { error } = await ctx.workspace.client
    .from("calls")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return ownerSaveFailed("inbox-triage", error.message);

  revalidatePath("/home");
  revalidatePath("/calls");
  if (opts?.revalidateTicket !== false) {
    revalidatePath(`/calls/${id}`);
  }
  return { ok: true };
}

export async function inboxToggleRead(
  callId: string,
  unread: boolean
): Promise<InboxTriageResult> {
  return writeInboxTriage(callId, {
    inbox_read_at: unread ? new Date().toISOString() : null,
  });
}

/** Unused by the list dot. Leaves `inbox_read_at` available without a schema revert. */
export async function inboxMarkSeen(callId: string): Promise<InboxTriageResult> {
  return writeInboxTriage(
    callId,
    { inbox_read_at: new Date().toISOString() },
    { revalidateTicket: false }
  );
}

export async function inboxToggleMute(
  callId: string,
  muted: boolean
): Promise<InboxTriageResult> {
  return writeInboxTriage(callId, { inbox_muted: !muted });
}

export async function inboxTogglePin(
  callId: string,
  pinnedAt: string | null
): Promise<InboxTriageResult> {
  return writeInboxTriage(callId, {
    inbox_pinned_at: pinnedAt ? null : new Date().toISOString(),
  });
}

export async function inboxAssignTeammate(
  callId: string,
  assignee: string
): Promise<InboxTriageResult> {
  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };

  const id = String(callId || "").trim();
  if (!id) return missingCall();

  const value = String(assignee || "").trim();
  const options = inboxTeammateOptions(ctx.tenant.team_directory);
  if (value && !isInboxTeammateValue(value, options)) {
    return { error: options.length ? "Pick a teammate." : "No teammates." };
  }

  const { error } = await ctx.workspace.client
    .from("calls")
    .update({ inbox_assignee: value || null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return ownerSaveFailed("inbox-assign", error.message);

  revalidatePath("/home");
  revalidatePath("/calls");
  revalidatePath(`/calls/${id}`);
  return { ok: true };
}

export async function inboxAddLabel(
  callId: string,
  label: string
): Promise<InboxTriageResult> {
  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };

  const id = String(callId || "").trim();
  if (!id) return missingCall();

  const next = sanitizeInboxLabel(label);
  if (!next) return { error: "Label is required." };

  const { data, error: readError } = await ctx.workspace.client
    .from("calls")
    .select("inbox_labels")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (readError) return ownerSaveFailed("inbox-label", readError.message);
  if (!data) return missingCall();

  const labels = parseInboxLabels(data.inbox_labels);
  if (!labels.some((row) => row.toLowerCase() === next.toLowerCase())) {
    labels.push(next);
  }

  const { error } = await ctx.workspace.client
    .from("calls")
    .update({ inbox_labels: labels })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return ownerSaveFailed("inbox-label", error.message);

  revalidatePath("/home");
  revalidatePath("/calls");
  revalidatePath(`/calls/${id}`);
  return { ok: true };
}

export async function inboxSnooze(callId: string): Promise<InboxTriageResult> {
  return writeInboxTriage(callId, {
    inbox_snoozed_until: inboxSnoozeUntilIso(),
  });
}
