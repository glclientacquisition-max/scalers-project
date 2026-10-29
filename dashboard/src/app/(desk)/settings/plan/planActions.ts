"use server";

import { effectivePaymentEnv } from "@/lib/billingRuntimeSettings";
import { memberDenied } from "@/lib/requireMember";
import { planChangePort, type PlanCycle } from "@/lib/deskPlanChange";
import { planChangesClosed, type PlanActionState } from "@/lib/planActionOutcome";

export type { PlanActionState };

/** Total extra seats, 0 to 100. Same bound as owner_set_extra_seats. */
const EXTRA_SEAT_TOTAL_MAX = 100;

export async function confirmPlanChange(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const denied = await memberDenied("billing.manage");
  if (denied) return denied;
  const sku = String(formData.get("sku") || "");
  const cycle = String(formData.get("cycle") || "");
  const idempotencyKey = String(formData.get("idempotency_key") || "").trim();
  if (!["starter", "growth", "scale"].includes(sku) || (cycle !== "month" && cycle !== "year")) {
    return { ok: false, error: "Choose a plan first." };
  }
  if (!idempotencyKey) return { ok: false, error: "Try again." };
  const env = await effectivePaymentEnv();
  if (env.DESK_PLAN_CHANGE !== "on") return planChangesClosed();
  return planChangePort(env).changePlan({
    sku,
    cycle: cycle as PlanCycle,
    idempotencyKey,
  });
}

export async function setExtraSeatsAction(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const denied = await memberDenied("billing.manage");
  if (denied) return denied;
  const extraSeats = Number(formData.get("extra_seats"));
  const idempotencyKey = String(formData.get("idempotency_key") || "").trim();
  if (!Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > EXTRA_SEAT_TOTAL_MAX) {
    return { ok: false, error: "Choose how many seats." };
  }
  if (!idempotencyKey) return { ok: false, error: "Try again." };
  const env = await effectivePaymentEnv();
  if (env.DESK_PLAN_CHANGE !== "on") return planChangesClosed();
  return planChangePort(env).setExtraSeats({ extraSeats, idempotencyKey });
}
