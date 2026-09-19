import { AdminSetupError } from "@/components/AdminSetupError";
import { BuyNumberPanel } from "@/components/BuyNumberPanel";
import { DidPoolManager } from "@/components/DidPoolManager";
import { SautikitSyncButton } from "@/components/SautikitSyncButton";
import { logAdminError } from "@/lib/adminErrors";
import { listDidPool, listPendingTenants } from "@/lib/didPool";

export default async function AdminNumbersPage() {
  let pool;
  let pendingBusinesses;
  try {
    [pool, pendingBusinesses] = await Promise.all([listDidPool(), listPendingTenants()]);
  } catch (err) {
    logAdminError("numbers", err);
    return <AdminSetupError />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-tight">Number pool</h2>
        <SautikitSyncButton />
      </div>
      <div className="mt-6 space-y-6">
        <BuyNumberPanel />
        <DidPoolManager pool={pool} pendingBusinesses={pendingBusinesses} />
      </div>
    </div>
  );
}
