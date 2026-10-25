import "server-only";

import { adminActorName } from "@/lib/adminActor";
import { adminErrorParts, adminFacingError, logAdminError } from "@/lib/adminErrors";
import { HOLD_SQL_MISSING } from "@/lib/ops/numberHold";
import { getSupabaseAdmin } from "@/lib/supabase";

function isHoldSqlMissing(err: unknown): boolean {
  const { message, code } = adminErrorParts(err);
  const text = `${message} ${code || ""}`;
  return /admin_set_number_hold_settings|admin_hold_number_for_winback|admin_end_number_hold|admin_restore_held_number|hold_winback_enabled|winback_hold|does not exist|schema cache|could not find the function|PGRST202|42883/i.test(
    text,
  );
}

export type HoldRpcResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; missing?: boolean };

async function callHoldRpc(name: string, args: Record<string, unknown>): Promise<HoldRpcResult> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(name, args);
    if (error) {
      if (isHoldSqlMissing(error)) {
        logAdminError("number-hold", error);
        return { ok: false, status: 503, error: HOLD_SQL_MISSING, missing: true };
      }
      logAdminError("number-hold", error);
      return { ok: false, status: 400, error: adminFacingError(error, "Could not update number hold.") };
    }
    return { ok: true, data };
  } catch (err) {
    if (isHoldSqlMissing(err)) {
      logAdminError("number-hold", err);
      return { ok: false, status: 503, error: HOLD_SQL_MISSING, missing: true };
    }
    logAdminError("number-hold", err);
    return { ok: false, status: 500, error: adminFacingError(err, "Could not update number hold.") };
  }
}

export async function setNumberHoldSettings(input: {
  enabled?: boolean | null;
  feeKes?: number | null;
  clearFee?: boolean;
  days?: number | null;
  reason: string;
}): Promise<HoldRpcResult> {
  const actor = await adminActorName();
  return callHoldRpc("admin_set_number_hold_settings", {
    p_enabled: input.enabled ?? null,
    p_fee_kes: input.clearFee ? null : input.feeKes ?? null,
    p_clear_fee: Boolean(input.clearFee),
    p_days: input.days ?? null,
    p_actor: actor,
    p_reason: input.reason,
    p_confirm: true,
  });
}

export async function holdNumberForWinback(input: {
  e164: string;
  days: number | null;
  reason: string;
}): Promise<HoldRpcResult> {
  const actor = await adminActorName();
  return callHoldRpc("admin_hold_number_for_winback", {
    p_e164: input.e164,
    p_days: input.days,
    p_actor: actor,
    p_reason: input.reason,
    p_confirm: true,
  });
}

export async function endNumberHold(input: { e164: string; reason: string }): Promise<HoldRpcResult> {
  const actor = await adminActorName();
  return callHoldRpc("admin_end_number_hold", {
    p_e164: input.e164,
    p_actor: actor,
    p_reason: input.reason,
    p_confirm: true,
  });
}

export async function restoreHeldNumber(input: {
  e164: string;
  tenantId: string;
  reason: string;
}): Promise<HoldRpcResult> {
  const actor = await adminActorName();
  return callHoldRpc("admin_restore_held_number", {
    p_e164: input.e164,
    p_tenant_id: input.tenantId,
    p_actor: actor,
    p_reason: input.reason,
    p_confirm: true,
  });
}
