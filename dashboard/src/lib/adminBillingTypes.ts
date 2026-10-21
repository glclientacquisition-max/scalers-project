export type AdminBillingStatus = "archived" | "ok" | "low_minutes" | "exhausted" | "charging";

export type AdminBillingRow = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  packageName: string | null;
  packageSku: string | null;
  period: "month" | "year" | null;
  periodEnd: string | null;
  periodEndLabel: string | null;
  minutesIncluded: number;
  minutesUsed: number;
  minutesRemaining: number;
  billing_enforcement: "off" | "soft" | "hard";
  on_demand_usage_enabled: boolean;
  status: AdminBillingStatus;
  statusLabel: string;
};

export type AdminBillingOverview = {
  rows: AdminBillingRow[];
  betaCount: number;
  chargingCount: number;
  lowMinutesCount: number;
  exhaustedCount: number;
  rolloverSoonCount: number;
  platformPeriodEndLabel: string | null;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  openInvoiceKesLabel: string;
  invoicesMissing: boolean;
};
