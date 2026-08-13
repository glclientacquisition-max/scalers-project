import { getAdminOverview } from "@/lib/admin";
import { AdminBusinessesPanel } from "@/components/AdminBusinessesPanel";

export default async function AdminBusinessesPage() {
  let overview;
  try {
    overview = await getAdminOverview();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load businesses: {message}
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-2xl tracking-tight">Businesses</h2>
      <div className="mt-6">
        <AdminBusinessesPanel
          businesses={overview.businesses}
          pendingBusinesses={overview.pendingBusinesses}
          availableDidCount={overview.availableDids}
        />
      </div>
    </div>
  );
}
