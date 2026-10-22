import "server-only";

/**
 * Stamp the owner's text-back on the call (summary.caller_reply_body /
 * caller_reply_at) after the SMS went out.
 *
 * ONE call to calls_record_caller_reply (#866): the database merges the two
 * keys into the summary in a single UPDATE, so two replies at once cannot
 * overwrite each other's summary. Runs as the signed-in member (the caller
 * passes the session client), so the RPC's write check applies.
 *
 * Fallback: where the function is not on this database yet (prod before
 * #866), the old read-modify-write of `calls.summary`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSummary } from "@/lib/supabase";

type RpcError = { code?: string | null; message: string };

export type CallerReplyRecord = {
  /** caller_reply_at as stored (RPC: "2026-10-21T22:37:45.322037+00:00"). */
  at: string | null;
  mode: "rpc" | "legacy";
  error: RpcError | null;
};

/** The RPC is not on this database (only then do we fall back). */
export function isCallerReplyRpcMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST202" || code === "42883") return true;
  const msg = String(error.message || "");
  return /calls_record_caller_reply/i.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

export async function recordCallerReply(opts: {
  client: SupabaseClient;
  tenantId: string;
  callId: string;
  body: string;
  now?: Date;
}): Promise<CallerReplyRecord> {
  const { data, error } = await opts.client.rpc("calls_record_caller_reply", {
    p_tenant_id: opts.tenantId,
    p_call_id: opts.callId,
    p_body: opts.body,
  });
  if (!error) {
    const at = data && typeof data === "object" ? (data as { at?: unknown }).at : null;
    return { at: typeof at === "string" ? at : null, mode: "rpc", error: null };
  }
  if (!isCallerReplyRpcMissing(error)) {
    return { at: null, mode: "rpc", error: { code: error.code, message: error.message } };
  }

  const { data: row } = await opts.client
    .from("calls")
    .select("summary")
    .eq("id", opts.callId)
    .eq("tenant_id", opts.tenantId)
    .maybeSingle();
  const raw = row?.summary as unknown;
  const meta =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : parseSummary(typeof raw === "string" ? raw : null);
  const at = (opts.now ?? new Date()).toISOString();
  const next = { ...meta, caller_reply_body: opts.body, caller_reply_at: at };
  const { error: sumErr } = await opts.client
    .from("calls")
    .update({ summary: JSON.stringify(next) })
    .eq("id", opts.callId)
    .eq("tenant_id", opts.tenantId);
  return { at: sumErr ? null : at, mode: "legacy", error: sumErr ? { code: sumErr.code, message: sumErr.message } : null };
}
