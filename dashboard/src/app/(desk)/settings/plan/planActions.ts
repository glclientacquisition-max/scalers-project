"use server";

import { memberDenied } from "@/lib/requireMember";
import { planChangePort, type PlanCycle } from "@/lib/deskPlanChange";

export type PlanActionState = {
  ok: false;
  message?: string;
  error?: string;
  denied?: boolean;
};

const CLOSED: PlanActionState = { ok: false, message: "Plan changes open soon" };

function closed(result: { ok: boolean }): PlanActionState {
  if (result.ok) return CLOSED;
  return CLOSED;
}

export async function confirmPlanChange(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const denied = await memberDenied("billing.manage");
  if (denied) return denied;
  const sku = String(formData.get("sku") || "");
  const cycle = String(formData.get("cycle") || "");
  if (!["starter", "growth", "scale"].includes(sku) || (cycle !== "month" && cycle !== "year")) {
    return { ok: false, error: "Choose a plan first." };
  }
  return closed(await planChangePort().changePlan({ sku, cycle: cycle as PlanCycle }));
}

export async function confirmSeatPurchase(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const denied = await memberDenied("billing.manage");
  if (denied) return denied;
  const quantity = Number(formData.get("quantity"));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    return { ok: false, error: "Choose how many seats." };
  }
  return closed(await planChangePort().addSeats({ quantity }));
}
