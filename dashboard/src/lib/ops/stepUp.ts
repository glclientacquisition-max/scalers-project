/**
 * Admin step-up mode + observe log. Spec: #876 / ADMIN_STEP_UP.
 * enforce is on only when ADMIN_STEP_UP_ENFORCE is exactly `on` (Alvin, 24 Oct 2026).
 * Enforcement itself lives in stepUpGate.ts (server). Never log secrets, codes, or cookies.
 */

export type StepUpMode = "off" | "observe" | "enforce";

export type StepUpEvent = {
  action: string;
  operator: string;
  /** Business id, e164, or similar — never a secret. */
  target?: string | null;
};

export function stepUpMode(env: NodeJS.ProcessEnv = process.env): StepUpMode {
  if (String(env.ADMIN_STEP_UP_ENFORCE ?? "") === "on") return "enforce";
  const raw = String(env.ADMIN_STEP_UP || "observe").trim().toLowerCase();
  if (raw === "off") return "off";
  return "observe";
}

/** observe logs would-require-step-up and returns; off and enforce are no-ops here (stepUpGate enforces). */
export function requireStepUp(event: StepUpEvent, env: NodeJS.ProcessEnv = process.env): void {
  if (stepUpMode(env) !== "observe") return;
  console.info(
    JSON.stringify({
      event: "would-require-step-up",
      action: event.action,
      operator: event.operator,
      target: event.target ?? null,
    }),
  );
}
