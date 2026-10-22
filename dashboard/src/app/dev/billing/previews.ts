/** QA business (Growth, paid) and a beta tenant (Starter, free during beta). Fixtures only. */
export const BILLING_PREVIEWS = [
  "plan",
  "plan-annual",
  "plan-upgrade",
  "plan-downgrade",
  "plan-seat-block",
  "trial",
  "billing",
  "billing-empty",
  "usage-paid",
  "team-paid",
  "banner",
  "plan-beta",
  "billing-beta",
  "usage-beta",
  "home-beta",
  "team-beta",
] as const;

export type BillingPreview = (typeof BILLING_PREVIEWS)[number];
