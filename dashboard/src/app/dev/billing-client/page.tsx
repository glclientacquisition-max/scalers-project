import { notFound } from "next/navigation";
import { AdminBillingDetailPanel } from "@/components/AdminBillingDetailPanel";
import type { AdminBillingClientDetail } from "@/lib/adminBilling";

/**
 * Super Admin billing client fixture. DASHBOARD_OPEN=true only.
 * Sample row only. Nothing here writes to billing.
 */
const DETAIL: AdminBillingClientDetail = {
  row: {
    id: "biz-demo",
    business_name: "Sample Shop",
    sautikit_virtual_number: "+254711000111",
    packageName: "Growth",
    packageSku: "growth",
    period: "month",
    minutesIncluded: 1000,
    minutesUsed: 640,
    minutesRemaining: 360,
    billing_enforcement: "off",
    on_demand_usage_enabled: false,
    status: "ok",
    statusLabel: "OK",
  },
  beta_notes: "Beta program",
  rates: {
    inboundKesPerSecond: 0.1,
    outboundKesPerSecond: 0.15,
    whatsappKes: 2,
    smsKes: 1,
    emailKes: 1,
    annualDiscountPercent: 17,
  },
  packages: [
    {
      id: "pkg-starter",
      sku: "starter",
      name: "Starter",
      monthlyPriceKes: 5000,
      seats: 2,
      minutes: 300,
      sms: 200,
      email: 100,
      staffWa: 200,
      dids: 1,
      sortOrder: 1,
      isActive: true,
    },
    {
      id: "pkg-growth",
      sku: "growth",
      name: "Growth",
      monthlyPriceKes: 12000,
      seats: 5,
      minutes: 1000,
      sms: 500,
      email: 300,
      staffWa: 500,
      dids: 1,
      sortOrder: 2,
      isActive: true,
    },
  ],
  subscription: {
    tenantId: "biz-demo",
    businessName: "Sample Shop",
    packageId: "pkg-growth",
    packageName: "Growth",
    period: "month",
    usage: {
      minutesIncluded: 1000,
      secondsUsed: 38400,
      smsIncluded: 500,
      smsUsed: 120,
      emailIncluded: 300,
      emailUsed: 45,
      waIncluded: 500,
      waUsed: 200,
      seatsIncluded: 5,
      seatsUsed: 3,
    },
    gap: null,
  },
};

export default function DevBillingClientPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-display text-page">{DETAIL.row.business_name}</h1>
        <AdminBillingDetailPanel detail={DETAIL} />
      </div>
    </main>
  );
}
