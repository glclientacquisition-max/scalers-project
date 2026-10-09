import { AdminOpsNotices, AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import { PlatformRunBoard } from "@/components/PlatformRunBoard";
import { logAdminError } from "@/lib/adminErrors";
import { readPlatformOps } from "@/lib/platformOps";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

/** Shows notices and health. Sends nothing: the scheduled check (api/cron/ops-alerts) opens and mails. */
export default async function AdminPlatformPage() {
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
      <AdminOpsNotices notices={snapshot.notices.filter((notice) => notice.status === "open")} />
      <PlatformRunBoard />
      <AdminPlatformOpsForm settings={snapshot.settings} persisted={snapshot.persisted} />
    </div>
  );
}
