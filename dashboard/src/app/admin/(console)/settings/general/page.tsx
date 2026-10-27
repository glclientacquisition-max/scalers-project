import { notFound } from "next/navigation";
import { AdminSettingsHubV2 } from "@/components/admin/v2/AdminSettingsHubV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadSettingsHub } from "@/lib/adminSettingsHubLoad";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** Settings hub (ADMIN_V2 only). Read-only. */
export default async function SettingsGeneralPage() {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  try {
    return <AdminSettingsHubV2 raw={await loadSettingsHub()} />;
  } catch (err) {
    logAdminError("settings-hub", err);
    return <DeskLoadError>Could not load settings.</DeskLoadError>;
  }
}
