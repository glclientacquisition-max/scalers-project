import { AdminOpsNotices, AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import { PlatformRunBoard } from "@/components/PlatformRunBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";

export const instant = false;

export default async function AdminPlatformPage() {
  let snapshot;
  try {
    snapshot = await evaluatePlatformOps();
  } catch (err) {
    logAdminError("platform", err);
    return <AdminSetupError />;
  }

  const openCount = snapshot.notices.filter((notice) => notice.status === "open").length;

  return (
    <div className="space-y-4">
      <PageHeader title="Platform" meta={openCount > 0 ? `${openCount} open` : undefined} />

      <AdminOpsNotices notices={snapshot.notices} />
      <PlatformRunBoard />
      <AdminPlatformOpsForm settings={snapshot.settings} persisted={snapshot.persisted} />
    </div>
  );
}
