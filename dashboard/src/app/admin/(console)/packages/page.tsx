import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
import { logAdminError } from "@/lib/adminErrors";
import { loadPackageCatalog } from "@/lib/packageCatalog";

export const instant = false;

export default async function AdminPackagesPage() {
  let catalog;
  try {
    catalog = await loadPackageCatalog();
  } catch (err) {
    logAdminError("packages", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl tracking-tight">Packages</h1>
      <AdminPackagesPanel {...catalog} />
    </div>
  );
}
