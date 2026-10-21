import "server-only";

/**
 * Server half of the inbox archive cascade. The caller passes the signed-in
 * member's session client, so inbox_archive_calls / inbox_undo_archive run
 * their own membership check (member_can_write) in the database.
 * Injectable client so tests can count round trips and fake a missing RPC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isInboxCascadeMissing,
  isUuid,
  parseInboxArchiveRpc,
  parseInboxUndoRpc,
  type InboxArchiveResult,
  type InboxUndoResult,
} from "@/lib/inboxArchiveCascade";
import { runInboxBulkUpdate } from "@/lib/inboxBulkRun";

type RpcError = { code?: string | null; message: string };

export type InboxArchiveRunResult =
  | { result: InboxArchiveResult; error: null }
  | { result: null; error: RpcError };

/**
 * ONE call to inbox_archive_calls (one transaction: calls + open holds +
 * open visits + undo record). If the function is not on this database
 * (#862 not applied), archive the calls with the #860 single update and
 * answer mode "legacy".
 */
export async function runInboxArchiveCalls(opts: {
  client: SupabaseClient;
  tenantId: string;
  callIds: string[];
}): Promise<InboxArchiveRunResult> {
  const uuids = opts.callIds.filter(isUuid);
  const notIds = opts.callIds.filter((id) => !isUuid(id)).map((id) => ({ id, reason: "not_found" }));
  if (uuids.length) {
    const { data, error } = await opts.client.rpc("inbox_archive_calls", {
      p_tenant_id: opts.tenantId,
      p_call_ids: uuids,
    });
    if (!error) {
      const result = parseInboxArchiveRpc(data);
      return { result: { ...result, skipped: [...(result.skipped || []), ...notIds] }, error: null };
    }
    if (!isInboxCascadeMissing(error)) return { result: null, error: { code: error.code, message: error.message } };
    console.warn("[inbox archive] cascade not on this database, using the calls-only archive");
  }
  const legacy = await runInboxBulkUpdate({
    client: opts.client,
    tenantId: opts.tenantId,
    kind: "archive",
    ids: opts.callIds,
  });
  if (legacy.error) return { result: null, error: { message: legacy.error.message } };
  const requested = new Set(opts.callIds);
  const updatedIds = legacy.rows.map((row) => String(row.id)).filter((id) => requested.has(id));
  const done = new Set(updatedIds);
  return {
    result: {
      ok: true,
      mode: "legacy",
      updatedIds,
      holds: [],
      visits: [],
      skipped: opts.callIds.filter((id) => !done.has(id)).map((id) => ({ id, reason: "not_found" })),
      undoId: null,
    },
    error: null,
  };
}

/** ONE call to inbox_undo_archive with the undo id the archive returned. */
export async function runInboxUndoArchive(opts: {
  client: SupabaseClient;
  tenantId: string;
  undoId: string;
}): Promise<{ result: InboxUndoResult; error: null } | { result: null; error: RpcError }> {
  const { data, error } = await opts.client.rpc("inbox_undo_archive", {
    p_tenant_id: opts.tenantId,
    p_undo_id: opts.undoId,
  });
  if (error) return { result: null, error: { code: error.code, message: error.message } };
  return { result: parseInboxUndoRpc(data), error: null };
}
