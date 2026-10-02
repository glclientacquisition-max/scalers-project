import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import { logAdminError } from "@/lib/adminErrors";
import { loadPackageCatalog } from "@/lib/packageCatalog";

export const instant = false;

export default async function AdminBillingCatalogPage() {
  let catalog;
  try {
    catalog = await loadPackageCatalog();
  } catch (err) {
    logAdminError("billing-catalog", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <h1 className={deskListTitleClass}>Catalog</h1>
      <AdminPackagesPanel {...catalog} catalogOnly />
    </div>
  );
}
