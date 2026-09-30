import { notFound } from "next/navigation";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
import type { BillingPackage, BillingRateCard, TenantSubscriptionRow } from "@/lib/packageCatalog";

/**
 * Super Admin packages fixture. DASHBOARD_OPEN=true only.
 * Straw prices match the public seed (monthly 0) so the Landing preview shows Not set.
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
    monthlyPriceKes: 0,
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
    monthlyPriceKes: 0,
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
    monthlyPriceKes: 0,
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
  },
  {
    tenantId: "ten-sample-b",
    businessName: "Sample Stationery",
    packageId: "pkg-growth",
    packageName: "Growth",
    period: "year",
  },
];

export default function DevPackagesPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="font-display text-page">Packages</h1>
        <AdminPackagesPanel rates={RATES} packages={PACKAGES} businesses={BUSINESSES} />
      </div>
    </main>
  );
}
