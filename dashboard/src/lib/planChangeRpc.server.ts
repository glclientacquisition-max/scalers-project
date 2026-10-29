"use server";

import {
  changePlanAction,
  setExtraSeatsAction,
} from "@/lib/ownerBillingActions";
import { planActionFromRpc, type PlanActionState } from "@/lib/planActionOutcome";
import type { PlanCycle } from "@/lib/deskPlanChange";

export async function rpcChangePlan(input: {
  sku: string;
  cycle: PlanCycle;
  idempotencyKey: string;
}): Promise<PlanActionState> {
  const period = input.cycle === "year" ? "year" : "month";
  return planActionFromRpc(
    await changePlanAction(input.sku, period, input.idempotencyKey),
  );
}

export async function rpcSetExtraSeats(input: {
  extraSeats: number;
  idempotencyKey: string;
}): Promise<PlanActionState> {
  return planActionFromRpc(
    await setExtraSeatsAction(input.extraSeats, input.idempotencyKey),
  );
}
