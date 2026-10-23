import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DidPoolManager } from "@/components/DidPoolManager";
import { logAdminError } from "@/lib/adminErrors";
import { listDidPool, listPendingTenants } from "@/lib/didPool";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { AdminNumbersV2 } from "@/components/admin/v2/AdminNumbersV2";
import { loadNumbersV2 } from "@/lib/adminNumbersV2Load";
import { loadSettingsHub } from "@/lib/adminSettingsHubLoad";
import { holdPolicyFromSettings } from "@/lib/ops/numberHold";

export const instant = false;

export default async function AdminNumbersPage() {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 === "on") {
    try {
      const [{ rows, waiting }, settings] = await Promise.all([
        loadNumbersV2(),
        loadSettingsHub().catch(() => null),
      ]);
      return (
        <AdminNumbersV2
          rows={rows}
          waiting={waiting}
          nowIso={new Date().toISOString()}
          holdPolicy={holdPolicyFromSettings(settings)}
        />
      );
    } catch (err) {
      logAdminError("numbers-v2", err);
      return <DeskLoadError backHref="/admin" backLabel="Overview">Numbers could not be loaded.</DeskLoadError>;
    }
  }
  let pool;
  let pendingBusinesses;
  try {
    [pool, pendingBusinesses] = await Promise.all([listDidPool(), listPendingTenants()]);
  } catch (err) {
    logAdminError("numbers", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Numbers" subtitle="Add, assign, and release lines in the pool." />
      <DidPoolManager pool={pool} pendingBusinesses={pendingBusinesses} />
    </div>
  );
}
