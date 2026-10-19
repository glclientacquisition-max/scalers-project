import { AdminOpsNotices, AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PlatformRunBoard } from "@/components/PlatformRunBoard";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminPlatformPage() {
  await requireSuperAdmin();
  let snapshot;
  try {
    snapshot = await evaluatePlatformOps();
  } catch (err) {
    logAdminError("platform", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Platform" subtitle="Health, open notices, and who to alert." />
      <AdminOpsNotices notices={snapshot.notices.filter((notice) => notice.status === "open")} />
      <PlatformRunBoard />
      <AdminPlatformOpsForm settings={snapshot.settings} persisted={snapshot.persisted} />
    </div>
  );
}
