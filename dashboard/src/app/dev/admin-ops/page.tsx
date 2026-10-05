import { notFound } from "next/navigation";
import { AdminBusinessesPanel } from "@/components/AdminBusinessesPanel";
import { DidPoolManager } from "@/components/DidPoolManager";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import type { AdminBusiness } from "@/lib/admin";
import type { DidPoolRow, PendingTenant } from "@/lib/didPool";

/**
 * Super Admin empty-pool and release fixture. DASHBOARD_OPEN=true only.
 * Sample rows only. Nothing here writes to the pool.
 */
const PENDING: PendingTenant[] = [
  {
    id: "biz-waiting",
    business_name: "Waiting Co",
    sautikit_virtual_number: "pending:biz-waiting",
    created_at: "2026-10-01T08:00:00.000Z",
  },
];

const POOL: DidPoolRow[] = [
  {
    id: "did-orphan",
    created_at: "2026-09-01T08:00:00.000Z",
    e164: "+254709221536",
    sautikit_number_id: null,
    status: "assigned",
    tenant_id: null,
    assigned_at: "2026-09-01T08:00:00.000Z",
    notes: "Business row already gone",
    tenants: null,
  },
  {
    id: "did-held",
    created_at: "2026-09-02T08:00:00.000Z",
    e164: "+254711000111",
    sautikit_number_id: null,
    status: "assigned",
    tenant_id: "biz-live",
    assigned_at: "2026-09-02T08:00:00.000Z",
    notes: null,
    tenants: { business_name: "Sample Shop" },
  },
];

const BUSINESSES: AdminBusiness[] = [
  {
    id: "biz-waiting",
    created_at: "2026-10-01T08:00:00.000Z",
    business_name: "Waiting Co",
    sautikit_virtual_number: "pending:biz-waiting",
    whatsapp_notification_number: "+254722000222",
    is_active: true,
    wallet_balance_kes: 0,
    telecom_wallet_balance_kes: 0,
    ai_wallet_balance_usd: 0,
    package_name: null,
    package_period: null,
    status: "waiting",
  },
  {
    id: "biz-live",
    created_at: "2026-09-02T08:00:00.000Z",
    business_name: "Sample Shop",
    sautikit_virtual_number: "+254711000111",
    whatsapp_notification_number: "+254733000333",
    is_active: true,
    wallet_balance_kes: 1200,
    telecom_wallet_balance_kes: 1200,
    ai_wallet_balance_usd: 0,
    package_name: "Starter",
    package_period: "month",
    status: "active",
  },
];

export default function DevAdminOpsPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-5xl space-y-12">
        <section className="space-y-4">
          <h1 className={deskListTitleClass}>Numbers</h1>
          <DidPoolManager pool={POOL} pendingBusinesses={PENDING} />
        </section>
        <section className="space-y-4">
          <h1 className={deskListTitleClass}>Businesses</h1>
          <AdminBusinessesPanel
            businesses={BUSINESSES}
            pendingBusinesses={PENDING}
            availableDids={[]}
          />
        </section>
      </div>
    </main>
  );
}
