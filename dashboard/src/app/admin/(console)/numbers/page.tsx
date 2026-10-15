import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminSetupError } from "@/components/AdminSetupError";
import { DidPoolManager } from "@/components/DidPoolManager";
import { logAdminError } from "@/lib/adminErrors";
import { listDidPool } from "@/lib/didPool";
import { listBusinesses, pendingFromBusinesses } from "@/lib/admin";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminNumbersPage() {
  await requireSuperAdmin();
  let pool;
  let pendingBusinesses;
  try {
    let businesses;
    [pool, businesses] = await Promise.all([listDidPool(), listBusinesses()]);
    pendingBusinesses = pendingFromBusinesses(businesses);
  } catch (err) {
    logAdminError("numbers", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Numbers" subtitle="Phone numbers you can assign to a business." />
      <DidPoolManager pool={pool} pendingBusinesses={pendingBusinesses} />
    </div>
  );
}
