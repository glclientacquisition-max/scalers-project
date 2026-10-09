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
    tenants: { business_name: "Sample Shop", is_active: true },
  },
];

const AVAILABLE_DIDS = [{ e164: "+254700000001" }, { e164: "+254700000002" }];

const BUSINESSES: AdminBusiness[] = [
  {
    id: "biz-waiting",
    created_at: "2026-10-01T08:00:00.000Z",
    business_name: "Waiting Co",
    sautikit_virtual_number: "pending:biz-waiting",
    whatsapp_notification_number: "+254722000222",
    is_active: true,
    archived_at: null,
    package_name: null,
    package_period: null,
    billing_enforcement: "off",
    status: "waiting",
  },
  {
    id: "biz-live",
    created_at: "2026-09-02T08:00:00.000Z",
    business_name: "Sample Shop with a long display name",
    sautikit_virtual_number: "+254711000111",
    whatsapp_notification_number: "+254733000333",
    is_active: true,
    archived_at: null,
    package_name: "Starter",
    package_period: "month",
    billing_enforcement: "soft",
    status: "active",
  },
  {
    id: "biz-archived",
    created_at: "2026-08-12T08:00:00.000Z",
    business_name: "Closed Kiosk",
    sautikit_virtual_number: "pending:biz-archived",
    whatsapp_notification_number: "pending",
    is_active: false,
    archived_at: "2026-08-20T08:00:00.000Z",
    package_name: null,
    package_period: null,
    billing_enforcement: "off",
    status: "archived",
  },
  {
    id: "biz-archived-recent",
    created_at: "2026-08-14T08:00:00.000Z",
    business_name: "Paused Salon",
    sautikit_virtual_number: "+254711000444",
    whatsapp_notification_number: "pending",
    is_active: false,
    archived_at: "2026-10-05T08:00:00.000Z",
    package_name: "Starter",
    package_period: "month",
    billing_enforcement: "off",
    status: "archived",
  },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `biz-page-${index + 1}`,
    created_at: "2026-07-01T08:00:00.000Z",
    business_name: `Shop ${index + 1}`,
    sautikit_virtual_number: `+25471100${String(200 + index).padStart(4, "0")}`,
    whatsapp_notification_number: "+254733000333",
    is_active: true,
    archived_at: null,
    package_name: index % 2 === 0 ? "Starter" : null,
    package_period: index % 2 === 0 ? ("month" as const) : null,
    billing_enforcement: "off" as const,
    status: "active" as const,
  })),
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
            availableDids={AVAILABLE_DIDS}
          />
        </section>
      </div>
    </main>
  );
}
