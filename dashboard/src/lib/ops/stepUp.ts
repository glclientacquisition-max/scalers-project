/**
 * Admin step-up gate (observe first). Spec: draft #876 / ADMIN_STEP_UP.
 * observe: log would-require-step-up and allow. enforce: not implemented yet.
 * Never log secrets, access codes, or cookies.
 */

export type StepUpMode = "off" | "observe" | "enforce";

export type StepUpEvent = {
  action: string;
  operator: string;
  /** Business id, e164, or similar — never a secret. */
  target?: string | null;
};

export function stepUpMode(env: NodeJS.ProcessEnv = process.env): StepUpMode {
  const raw = String(env.ADMIN_STEP_UP || "observe").trim().toLowerCase();
  if (raw === "off" || raw === "enforce") return raw;
  return "observe";
}

/**
 * Call before a sensitive Admin write. observe logs and returns; off is a no-op;
 * enforce throws (unreachable in this slice — Preview stays on observe).
 */
export function requireStepUp(event: StepUpEvent, env: NodeJS.ProcessEnv = process.env): void {
  const mode = stepUpMode(env);
  if (mode === "off") return;
  if (mode === "enforce") {
    throw new Error("step-up enforce not implemented");
  }
  // observe (default)
  console.info(
    JSON.stringify({
      event: "would-require-step-up",
      action: event.action,
      operator: event.operator,
      target: event.target ?? null,
    }),
  );
}
