"use server";

import { getAuthUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ownerBillingRefusal, type OwnerBillingRefusal } from "@/lib/ownerBilling";

type RpcResult = OwnerBillingRefusal | Record<string, unknown>;

async function roleOf(tenantId: string, userId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const role = (data as { role?: string }).role;
  return role ? String(role) : null;
}

async function ready(): Promise<{ userId: string; tenantId: string } | OwnerBillingRefusal> {
  const user = await getAuthUser();
  const tenant = await getCurrentTenant();
  const role = user && tenant ? await roleOf(tenant.id, user.id) : null;
  const refused = ownerBillingRefusal({
    userId: user?.id ?? null,
    tenantId: tenant?.id ?? null,
    role,
  });
  if (refused) return refused;
  return { userId: user!.id, tenantId: tenant!.id };
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const ctx = await ready();
  if ("code" in ctx) return ctx;
  const { data, error } = await getSupabaseAdmin().rpc(fn, {
    p_tenant_id: ctx.tenantId,
    p_actor: ctx.userId,
    ...args,
  });
  if (error) {
    return { ok: false, code: "rpc_failed", message: "That change did not save. Try again." };
  }
  return (data ?? { ok: false, code: "rpc_failed", message: "That change did not save. Try again." }) as RpcResult;
}

export async function previewPlanChangeAction(sku: string, period: string): Promise<RpcResult> {
  return callRpc("owner_preview_plan_change", {
    p_package_sku: sku,
    p_period: period,
  });
}

export async function changePlanAction(
  sku: string,
  period: string,
  idempotencyKey: string
): Promise<RpcResult> {
  return callRpc("owner_change_plan", {
    p_package_sku: sku,
    p_period: period,
    p_idempotency_key: idempotencyKey,
  });
}

export async function cancelPlanChangeAction(idempotencyKey: string): Promise<RpcResult> {
  return callRpc("owner_cancel_plan_change", { p_idempotency_key: idempotencyKey });
}

export async function setExtraSeatsAction(
  extraSeats: number,
  idempotencyKey: string
): Promise<RpcResult> {
  return callRpc("owner_set_extra_seats", {
    p_extra_seats: extraSeats,
    p_idempotency_key: idempotencyKey,
  });
}

export async function setSpendLimitAction(
  limitKes: number | null,
  idempotencyKey: string
): Promise<RpcResult> {
  return callRpc("owner_set_spend_limit", {
    p_limit_kes: limitKes,
    p_idempotency_key: idempotencyKey,
  });
}
