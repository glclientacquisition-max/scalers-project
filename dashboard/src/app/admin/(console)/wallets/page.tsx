import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminWalletsPanel } from "@/components/AdminWalletsPanel";
import { logAdminError } from "@/lib/adminErrors";
import { listAdminWallets } from "@/lib/adminWallets";

// instant = false: request-time Super Admin data under the admin auth shell.
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
      <h1 className="font-display text-2xl tracking-tight">Wallets</h1>
      <AdminWalletsPanel {...overview} />
    </div>
  );
}
