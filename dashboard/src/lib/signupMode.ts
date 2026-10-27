export type SignupMode = "request" | "open";

/** Default open: today's self sign-up until SIGNUP_MODE=request. */
export function getSignupMode(): SignupMode {
  const raw = String(process.env.SIGNUP_MODE || "open").trim().toLowerCase();
  if (raw === "request") return "request";
  return "open";
}

export function isOpenSignupEnabled(): boolean {
  return getSignupMode() === "open";
}

/** Marketing and auth entry links (/signup). */
export function signupCtaLabel(): string {
  return getSignupMode() === "request" ? "Request access" : "Sign up";
}
