/** Shared by /admin/platform (old shell) and /admin/settings/services (ADMIN_V2). */
import { AdminOpsNotices, AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PlatformRunBoard } from "@/components/PlatformRunBoard";
import { logAdminError } from "@/lib/adminErrors";
import { readPlatformOps } from "@/lib/platformOps";
import { requireSuperAdmin } from "@/lib/adminGuard";

export async function ServicesScreen() {
  await requireSuperAdmin();
  let snapshot;
  try {
    snapshot = await readPlatformOps();
  } catch (err) {
    logAdminError("platform", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title={process.env.ADMIN_V2 === "on" ? "Services" : "Platform"} subtitle="Health, open notices, and who to alert." />
      <AdminOpsNotices notices={snapshot.notices.filter((notice) => notice.status === "open")} />
      <PlatformRunBoard />
      <AdminPlatformOpsForm settings={snapshot.settings} persisted={snapshot.persisted} />
    </div>
  );
}
