/**
 * Owner-facing copy when call minutes exceed the included allowance.
 * Used on Plan (beta summary and paid picker) whenever used > included.
 */

export type PlanOverageMode = "beta" | "trial_locked" | "on_demand" | "hard_stop";

export function planMinutesExtra(used: number, included: number): number | null {
  const inc = Math.max(0, Math.floor(included));
  const use = Math.max(0, Math.floor(used));
  if (inc <= 0 || use <= inc) return null;
  return use - inc;
}

export function planOverageHeadline(used: number, included: number): string | null {
  const extra = planMinutesExtra(used, included);
  if (extra == null) return null;
  const n = extra.toLocaleString("en-KE");
  return extra === 1 ? `${n} extra minute` : `${n} extra minutes`;
}

export function planOverageDetail(mode: PlanOverageMode, periodEndLabel: string | null): string {
  switch (mode) {
    case "beta":
      return "Free during beta. Extra minutes are not billed.";
    case "trial_locked":
      return "Extra usage is not billed during trial.";
    case "on_demand":
      return "Extra minutes bill on your next invoice at your plan rates.";
    default:
      return periodEndLabel
        ? `On-demand usage is off. Calls stop until usage resets after ${periodEndLabel}.`
        : "On-demand usage is off. Calls stop until the period renews.";
  }
}

export function resolvePlanOverageMode(opts: {
  freeBeta?: boolean;
  onDemandLocked?: boolean;
  onDemandEnabled?: boolean | null;
}): PlanOverageMode {
  if (opts.freeBeta) return "beta";
  if (opts.onDemandLocked) return "trial_locked";
  if (opts.onDemandEnabled === true) return "on_demand";
  return "hard_stop";
}

export function planOverageLines(
  used: number,
  included: number,
  mode: PlanOverageMode,
  periodEndLabel: string | null,
): { headline: string; detail: string } | null {
  const headline = planOverageHeadline(used, included);
  if (!headline) return null;
  return { headline, detail: planOverageDetail(mode, periodEndLabel) };
}
