/**
 * Current businesses stay on free metered beta.
 * Missing subscription row, missing tables, or billing_status beta: this view only.
 */

export function isFreeBeta(status: string | null | undefined): boolean {
  return !status || status === "beta";
}

export type OwnerBillingSurface = {
  headline: "Free during beta" | null;
  showInvoices: boolean;
  showPayLinks: boolean;
  showDunningBanner: boolean;
  showEnforcement: boolean;
  showPlanPicker: boolean;
};

export function ownerBillingSurface(status: string | null | undefined): OwnerBillingSurface {
  if (isFreeBeta(status)) {
    return {
      headline: "Free during beta",
      showInvoices: false,
      showPayLinks: false,
      showDunningBanner: false,
      showEnforcement: false,
      showPlanPicker: false,
    };
  }
  return {
    headline: null,
    showInvoices: true,
    showPayLinks: true,
    showDunningBanner: true,
    showEnforcement: true,
    showPlanPicker: true,
  };
}
