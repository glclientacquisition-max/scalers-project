import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminWalletsPanel } from "@/components/AdminWalletsPanel";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import { logAdminError } from "@/lib/adminErrors";
import { listAdminWallets } from "@/lib/adminWallets";

export const instant = false;

export default async function AdminWalletsPage() {
  let overview;
  try {
    overview = await listAdminWallets();
  } catch (err) {
    logAdminError("wallets", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <h1 className={deskListTitleClass}>Ledger</h1>
      <AdminWalletsPanel
        rows={overview.rows}
        betaCount={overview.betaCount}
        chargingCount={overview.chargingCount}
        lowCount={overview.lowCount}
        overdrawnCount={overview.overdrawnCount}
        totalLedgerBalanceKes={overview.totalLedgerBalanceKes}
      />
    </div>
  );
}
