"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { cleanInboxBulkIds } from "@/lib/inboxBulk";
import {
  inboxCascadeErrorText,
  isUuid,
  type InboxArchiveResult,
  type InboxUnarchiveResult,
  type InboxUndoResult,
} from "@/lib/inboxArchiveCascade";
import { runInboxArchiveCalls, runInboxUnarchiveCalls, runInboxUndoArchive } from "@/lib/inboxArchiveRun";

function revalidateInbox(callIds: string[]) {
  revalidatePath("/home");
  revalidatePath("/calls");
  revalidatePath("/requests");
  revalidatePath("/appointments");
  for (const id of callIds) revalidatePath(`/calls/${id}`);
}

/**
 * Archive (bulk bar, row menu, ticket menu): archive these calls and their
 * open holds and visits in one database transaction (inbox_archive_calls).
 * Runs as the signed-in member, so the database checks write access too.
 */
export async function inboxArchiveCallsAction(callIds: string[]): Promise<InboxArchiveResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return { error: denied.error };
  if (!(await isAuthenticated())) return { error: "Not signed in." };
  const clean = cleanInboxBulkIds(callIds);
  if (!clean) return { error: "Nothing selected." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { result, error } = await runInboxArchiveCalls({ client: workspace.client, tenantId: tenant.id, callIds: clean });
  if (error) {
    const text = inboxCascadeErrorText(error, "archive");
    if (text) return { error: text };
    return ownerSaveFailed("inbox-archive", error.message, "Could not archive.");
  }
  revalidateInbox(result.updatedIds || []);
  return result;
}

/** Undo an archive with its undo record (inbox_undo_archive). */
export async function inboxUndoArchiveAction(undoId: string): Promise<InboxUndoResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return { error: denied.error };
  if (!(await isAuthenticated())) return { error: "Not signed in." };
  if (!isUuid(undoId)) return { error: "Nothing to undo." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { result, error } = await runInboxUndoArchive({ client: workspace.client, tenantId: tenant.id, undoId });
  if (error) {
    const text = inboxCascadeErrorText(error, "undo");
    if (text) return { error: text };
    return ownerSaveFailed("inbox-undo-archive", error.message, "Could not undo.");
  }
  revalidateInbox(result.restored?.calls || []);
  return result;
}

/**
 * Unarchive (bulk bar, row menu, ticket menu): archived calls back to New and
 * their holds and visits back in the inbox, in one transaction
 * (inbox_unarchive_calls). Runs as the signed-in member.
 */
export async function inboxUnarchiveCallsAction(callIds: string[]): Promise<InboxUnarchiveResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return { error: denied.error };
  if (!(await isAuthenticated())) return { error: "Not signed in." };
  const clean = cleanInboxBulkIds(callIds);
  if (!clean) return { error: "Nothing selected." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { result, error } = await runInboxUnarchiveCalls({ client: workspace.client, tenantId: tenant.id, callIds: clean });
  if (error) {
    const text = inboxCascadeErrorText(error, "unarchive");
    if (text) return { error: text };
    return ownerSaveFailed("inbox-unarchive", error.message, "Could not save.");
  }
  revalidateInbox(result.updatedIds || []);
  return result;
}
