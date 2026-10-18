/**
 * Plan-change and seat RPCs arrive with Ops' API contract.
 * Both flag states refuse until that port is swapped in below.
 * Never return ok: true from this adapter.
 */

export type PlanChangeResult = { ok: false; message: "Plan changes open soon" };

export type PlanCycle = "month" | "year";

export type PlanChangePort = {
  changePlan: (input: { sku: string; cycle: PlanCycle }) => Promise<PlanChangeResult>;
  /** `extraSeats` is the new total, matching owner_set_extra_seats. */
  setExtraSeats: (input: { extraSeats: number; idempotencyKey: string }) => Promise<PlanChangeResult>;
};

const CLOSED: PlanChangeResult = { ok: false, message: "Plan changes open soon" };

const closedPort: PlanChangePort = {
  async changePlan() {
    return CLOSED;
  },
  async setExtraSeats() {
    return CLOSED;
  },
};

export function deskPlanChangeEnabled(): boolean {
  return process.env.DESK_PLAN_CHANGE === "true";
}

export function planChangePort(): PlanChangePort {
  if (!deskPlanChangeEnabled()) return closedPort;
  // Swap point: return the Ops RPC port here when the contract is in.
  return closedPort;
}
