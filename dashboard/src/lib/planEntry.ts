/**
 * Where the owner changes plan, and what the button says. Pure, no imports,
 * so node tests load it directly. Beta matches isFreeBeta in betaBilling.ts.
 */
function isFreeBeta(status: string | null | undefined): boolean {
  return !status || status === "beta";
}

export type PlanEntry = {
  href: "/settings/plan";
  label: "Choose a plan" | "Change plan";
  variant: "primary" | "tonal";
};

/** Beta businesses get no plan change anywhere. Trial picks a first plan. */
export function planEntry(status: string | null | undefined, canManage: boolean): PlanEntry | null {
  if (!canManage || isFreeBeta(status)) return null;
  if (status === "trialing") return { href: "/settings/plan", label: "Choose a plan", variant: "primary" };
  return { href: "/settings/plan", label: "Change plan", variant: "tonal" };
}

/** Status on the Settings Plan row: the plan name, or "Choose a plan" on trial. */
export function planRowText(status: string | null | undefined, planName: string | null | undefined): string {
  if (status === "trialing") return "Choose a plan";
  return String(planName || "").trim();
}

export type MeterTone = "ok" | "warn" | "full";

/** Minutes warn from this share used. Seats and message credits warn only when used up. */
export const MINUTES_WARN_SHARE = 0.8;

export function meterTone(used: number, included: number, warnShare: number | null): MeterTone {
  if (included <= 0) return "ok";
  if (used >= included) return "full";
  if (warnShare != null && used / included >= warnShare) return "warn";
  return "ok";
}

/** Bar fill: the share used, 0 to 100. */
export function usedPercent(used: number, included: number): number {
  if (included <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / included) * 100)));
}
