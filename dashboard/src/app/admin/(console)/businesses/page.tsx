import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBusinessesPanel } from "@/components/AdminBusinessesPanel";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";

// instant = false: request-time Super Admin data under the admin auth shell.
export const instant = false;

export default async function AdminBusinessesPage() {
  let overview;
  try {
    overview = await getAdminOverview();
  } catch (err) {
    logAdminError("businesses", err);
    return <AdminSetupError />;
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
