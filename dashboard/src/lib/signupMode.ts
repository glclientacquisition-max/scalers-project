export type SignupMode = "request" | "open";

/** Default closed: invite-only via access request form. */
export function getSignupMode(): SignupMode {
  const raw = String(process.env.SIGNUP_MODE || "request")
    .trim()
    .toLowerCase();
  if (raw === "open") return "open";
  return "request";
}

export function isOpenSignupEnabled(): boolean {
  return getSignupMode() === "open";
}
