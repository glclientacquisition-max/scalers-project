"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { sendRecordedDeskCallerSms } from "@/lib/sendLedger";
import { cleanInboxBulkIds, inboxBulkWrite, isInboxBulkKind, type InboxBulkKind } from "@/lib/inboxBulk";
import { inboxBulkCallerTexts, runInboxBulkUpdate } from "@/lib/inboxBulkRun";

export type InboxBulkResult = {
  ok?: boolean;
  error?: string;
  /** Rows the update matched in this business. */
  count?: number;
  /**
   * Ids the update actually changed. Requested ids missing here were not
   * updated (already handled, gone, or another business); the client reports them.
   */
  updatedIds?: string[];
  message?: string;
  /** Saved, but a caller text did not go out (line paused or business closed). */
  notice?: string;
};

const FAILED: Record<InboxBulkKind, string> = {
  archive: "Could not archive.",
  unarchive: "Could not save.",
  mark_done: "Could not save.",
  confirm: "Could not save appointment.",
  done: "Could not save request.",
};

/**
 * One server request for an inbox bulk action or archive Undo: same checks as
 * the single-row actions (member can act on the inbox, signed in, business
 * linked), then ONE update scoped to this business for every selected id.
 */
export async function inboxBulkAction(kind: InboxBulkKind, ids: string[]): Promise<InboxBulkResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return { error: denied.error };
  if (!(await isAuthenticated())) return { error: "Not signed in." };
  if (!isInboxBulkKind(kind)) return { error: "Invalid action." };
  const clean = cleanInboxBulkIds(ids);
  if (!clean) return { error: "Nothing selected." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { rows, error } = await runInboxBulkUpdate({
    client: workspace.client,
    tenantId: tenant.id,
    kind,
    ids: clean,
  });
  if (error) return ownerSaveFailed(`inbox-bulk-${kind}`, error.message, FAILED[kind]);

  // Caller texts are one send per caller by nature (each is its own message
  // and ledger row); the database writes above are already a single update.
  let notice: string | undefined;
  for (const text of inboxBulkCallerTexts({ kind, rows, tenant })) {
    const sent = await sendRecordedDeskCallerSms({
      client: workspace.client,
      tenantId: tenant.id,
      callId: text.callId,
      kind: text.kind,
      to: text.to,
      body: text.body,
    });
    if (!sent.ok) console.warn("[inbox bulk caller sms]", sent.reason);
    if (sent.message) notice = sent.message;
  }

  const table = inboxBulkWrite(kind).table;
  revalidatePath("/home");
  revalidatePath("/calls");
  if (table === "appointments") revalidatePath("/appointments");
  if (table === "service_requests") revalidatePath("/requests");
  const callIds = new Set<string>();
  for (const row of rows) {
    const callId = table === "calls" ? row.id : row.call_id;
    if (callId) callIds.add(String(callId));
  }
  for (const callId of callIds) revalidatePath(`/calls/${callId}`);

  const requested = new Set(clean);
  const updatedIds = rows.map((row) => String(row.id)).filter((id) => requested.has(id));
  const result: InboxBulkResult = { ok: true, count: updatedIds.length, updatedIds };
  return notice ? { ...result, notice } : result;
}
