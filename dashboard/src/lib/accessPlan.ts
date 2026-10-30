/**
 * Plan picked on /pricing, carried through Request access. Stored as a prefix on access_requests.about,
 * so no schema change. Beta is the featured choice; package skus come from billing_packages.
 */
export const BETA_PLAN = "beta";

/** Beta program copy (one place, easy to edit). Terms are Alvin's to confirm: no "free", no trial. */
export const BETA_PROGRAM = {
  name: "Beta program",
  line: "We review each request and agree terms before you start.",
  points: ["We set it up with you", "Your prices, hours and answers", "Keep your number"],
} as const;

const SKU = /^[a-z0-9_-]{1,32}$/;

/** Clean a ?plan= value. Unknown shapes become null (no plan shown). */
export function accessPlanFromParam(raw: unknown): string | null {
  const v = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase();
  return SKU.test(v) ? v : null;
}

export function accessPlanLabel(plan: string): string {
  if (plan === BETA_PLAN) return BETA_PROGRAM.name;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** "[Plan: Beta program] about…" so the owner sees the choice in the request. */
export function withPlanPrefix(about: string, plan: string | null): string {
  return plan ? `[Plan: ${accessPlanLabel(plan)}] ${about}` : about;
}
