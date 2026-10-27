import "server-only";

import { cookies } from "next/headers";
import { recordAdminAction } from "@/lib/adminAudit";
import { logAdminError } from "@/lib/adminErrors";
import { UNLOCK_COOKIE } from "@/lib/ops/stepUpCore";
import { stepUpMode } from "@/lib/ops/stepUp";
import {
  mapNumberOpError,
  mapNumberOpResult,
  numberOpRpc,
  type NumberOpError,
  type NumberOpInput,
  type NumberOpResult,
} from "@/lib/ops/numberOps";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Server side of Admin number controls. Service role only; never import into a client file.
 * The #968 RPCs write their own ops_audit_log row (via _billing_audit) inside the same
 * transaction with before/after and the reason. This adds the step-up proof the RPC can't see.
 */

export type StepUpProof = { grant_id: string | null; method: string | null; mode: string };

/** The Unlock grant this request rode on, for detail.step_up. Never reads codes or secrets. */
export async function currentStepUpProof(): Promise<StepUpProof> {
  const mode = stepUpMode();
  try {
    const id = (await cookies()).get(UNLOCK_COOKIE)?.value;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return { grant_id: null, method: null, mode };
    const { data } = await getSupabaseAdmin()
      .from("admin_step_up_grant")
      .select("id, method")
      .eq("id", id)
      .maybeSingle();
    const row = data as { id: string; method: string | null } | null;
    return { grant_id: row?.id ?? null, method: row?.method ?? null, mode };
  } catch (err) {
    logAdminError("number-ops", err);
    return { grant_id: null, method: null, mode };
  }
}

export async function runNumberOp(
  input: NumberOpInput,
  actor: string,
): Promise<{ ok: true; result: NumberOpResult } | ({ ok: false } & NumberOpError)> {
  const { fn, args } = numberOpRpc(input, actor);
  try {
    const { data, error } = await getSupabaseAdmin().rpc(fn, args);
    if (error) {
      logAdminError("number-ops", error);
      return { ok: false, ...mapNumberOpError(error) };
    }
    return { ok: true, result: mapNumberOpResult(input.action, data, input.e164) };
  } catch (err) {
    logAdminError("number-ops", err);
    return { ok: false, ...mapNumberOpError(err) };
  }
}

function businessOf(input: NumberOpInput): string | null {
  if (input.action === "restore") return input.businessId;
  if (input.action === "move") return input.toBusinessId;
  return null;
}

/** One ops_audit_log row per attempt that reached the RPC, plus refusals of the protected line. */
export async function auditNumberOp(entry: {
  actor: string;
  input: NumberOpInput | null;
  outcome: "done" | "already_done" | "refused";
  stepUp: StepUpProof;
  result?: NumberOpResult;
  error?: string;
  code?: string;
  e164?: string | null;
}): Promise<void> {
  const input = entry.input;
  await recordAdminAction({
    actor: entry.actor,
    action: `admin.number_ops.${input?.action ?? "refused"}`,
    businessId: input ? businessOf(input) : null,
    reason: input?.reason ?? null,
    detail: {
      outcome: entry.outcome,
      e164: input?.e164 ?? entry.e164 ?? null,
      ...(input?.action === "move" ? { from_business_id: input.fromBusinessId, to_business_id: input.toBusinessId } : {}),
      ...(input?.action === "lift_quarantine" ? { confirmed: input.confirm } : {}),
      step_up: entry.stepUp,
      ...(entry.result ? { noop: entry.result.noop, pool_status: entry.result.poolStatus } : {}),
      ...(entry.code ? { code: entry.code } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    },
  });
}
