import { AdminSetupError } from "@/components/AdminSetupError";
import { deskListTitleClass } from "@/components/ui/deskChrome";
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
      <h1 className={deskListTitleClass}>Businesses</h1>
      <div className="mt-6">
        <AdminBusinessesPanel
          businesses={overview.businesses}
          pendingBusinesses={overview.pendingBusinesses}
          availableDids={overview.pool
            .filter((row) => row.status === "available")
            .map((row) => ({ e164: row.e164 }))}
        />
      </div>
    </div>
  );
}
