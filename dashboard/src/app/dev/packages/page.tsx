import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminPhonePull } from "@/components/PhonePullSurface";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
import type { BillingPackage, BillingRateCard, TenantSubscriptionRow } from "@/lib/packageCatalog";
import { emptyPackageUsage } from "@/lib/packageUsageAlign";

/**
 * Super Admin packages fixture. DASHBOARD_OPEN=true only.
 * Prices match the public catalog. Each package includes 1 number.
 */
const RATES: BillingRateCard = {
  inboundKesPerSecond: 0.1,
  outboundKesPerSecond: 0.15,
  whatsappKes: 2,
  smsKes: 1,
  emailKes: 1,
  annualDiscountPercent: 17,
};

const PACKAGES: BillingPackage[] = [
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
    minutes: 800,
    sms: 500,
    email: 250,
    staffWa: 500,
    dids: 1,
    sortOrder: 2,
    isActive: true,
  },
  {
    id: "pkg-scale",
    sku: "scale",
    name: "Scale",
    monthlyPriceKes: 25000,
    seats: 10,
    minutes: 2000,
    sms: 1500,
    email: 500,
    staffWa: 1000,
    dids: 1,
    sortOrder: 3,
    isActive: true,
  },
];

const BUSINESSES: TenantSubscriptionRow[] = [
  {
    tenantId: "ten-sample-a",
    businessName: "Sample Dental",
    packageId: "pkg-starter",
    packageName: "Starter",
    period: "month",
    usage: {
      ...emptyPackageUsage(),
      minutesIncluded: 300,
      smsIncluded: 200,
      emailIncluded: 100,
      waIncluded: 200,
      seatsIncluded: 2,
      seatsUsed: 1,
    },
    gap: null,
  },
  {
    tenantId: "ten-sample-b",
    businessName: "Sample Stationery",
    packageId: null,
    packageName: null,
    period: null,
    usage: {
      ...emptyPackageUsage(),
      secondsUsed: 107,
      smsIncluded: 200,
      smsUsed: 47,
      emailIncluded: 100,
      seatsIncluded: 5,
      seatsUsed: 1,
    },
    gap: "No package",
  },
];

export default function DevPackagesPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main data-admin-main="" data-pull-dirty-guard="" className="min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <Suspense fallback={null}>
        <AdminPhonePull />
      </Suspense>
      <div className="mx-auto max-w-5xl space-y-4">
        <AdminPackagesPanel rates={RATES} packages={PACKAGES} businesses={BUSINESSES} />
      </div>
    </main>
  );
}
