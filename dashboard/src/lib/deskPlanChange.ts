/**
 * Plan-change and seat RPCs. Screens stay off unless DESK_PLAN_CHANGE is on.
 */

import { deskPlanChangeOn } from "./deskPlanChange";
import { planChangesClosed, type PlanActionState } from "./planActionOutcome";

export { deskPlanChangeOn };

export type PlanCycle = "month" | "year";

export type PlanChangePort = {
  changePlan: (input: {
    sku: string;
    cycle: PlanCycle;
    idempotencyKey: string;
  }) => Promise<PlanActionState>;
  setExtraSeats: (input: {
    extraSeats: number;
    idempotencyKey: string;
  }) => Promise<PlanActionState>;
};

const closedPort: PlanChangePort = {
  async changePlan() {
    return planChangesClosed();
  },
  async setExtraSeats() {
    return planChangesClosed();
  },
};

export function deskPlanChangeEnabled(): boolean {
  return process.env.DESK_PLAN_CHANGE === "on";
}

export function planChangePort(env: NodeJS.ProcessEnv = process.env): PlanChangePort {
  if (!deskPlanChangeOn(env)) return closedPort;
  return {
    async changePlan(input) {
      const { rpcChangePlan } = await import("./planChangeRpc.server");
      return rpcChangePlan(input);
    },
    async setExtraSeats(input) {
      const { rpcSetExtraSeats } = await import("./planChangeRpc.server");
      return rpcSetExtraSeats(input);
    },
  };
}
