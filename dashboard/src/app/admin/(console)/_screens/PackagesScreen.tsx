/** Shared by /admin/packages (old shell) and /admin/billing/packages (ADMIN_V2). */
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPackageVersionsPanel } from "@/components/AdminPackageVersionsPanel";
import { AdminPackagesV2 } from "@/components/admin/v2/AdminPackagesV2";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { planWritesBlockedLine } from "@/lib/adminBillingCopy";
import { loadPackageVersionEditor } from "@/lib/packageVersionCatalog";

export async function PackagesScreen() {
  await requireSuperAdmin();
  try {
    const editor = await loadPackageVersionEditor();
    const planWritesEnabled = editor.catalog.packageEditorEnabled;
    const readOnlyHint = planWritesBlockedLine(editor.catalog.packageEditorEnabled);
    if (process.env.ADMIN_V2 === "on") {
      return <AdminPackagesV2 catalog={editor.catalog} readOnlyHint={readOnlyHint} />;
    }
    return (
      <div className="space-y-4">
        <AdminPageHeader title={process.env.ADMIN_V2 === "on" ? "Packages" : "Plans"} />
        <AdminPackageVersionsPanel
          catalog={editor.catalog}
          businesses={editor.businesses}
          planWritesEnabled={planWritesEnabled}
          readOnlyHint={readOnlyHint}
        />
      </div>
    );
  } catch (err) {
    logAdminError("packages", err);
    return <AdminSetupError />;
  }
}
