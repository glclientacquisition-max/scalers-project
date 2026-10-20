import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPackageVersionsPanel } from "@/components/AdminPackageVersionsPanel";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { planWritesBlockedLine } from "@/lib/adminBillingCopy";
import { loadPackageVersionEditor } from "@/lib/packageVersionCatalog";

export const instant = false;

export default async function AdminPackagesPage() {
  await requireSuperAdmin();
  try {
    const editor = await loadPackageVersionEditor();
    const planWritesEnabled = editor.catalog.packageEditorEnabled;
    const readOnlyHint = planWritesBlockedLine(editor.catalog.packageEditorEnabled);
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Plans" />
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
