import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DidPoolManager } from "@/components/DidPoolManager";
import { logAdminError } from "@/lib/adminErrors";
import { listDidPool, listPendingTenants } from "@/lib/didPool";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminNumbersPage() {
  await requireSuperAdmin();
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
