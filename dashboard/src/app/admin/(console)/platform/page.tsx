import { AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
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

  return (
    <div className="space-y-8">
      <PageHeader title="Platform" />

      <PlatformRunBoard />

      <AdminPlatformOpsForm
        settings={snapshot.settings}
        persisted={snapshot.persisted}
        notices={snapshot.notices}
      />
    </div>
  );
}
