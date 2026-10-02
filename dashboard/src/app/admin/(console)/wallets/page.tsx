import Link from "next/link";
import { AdminSetupError } from "@/components/AdminSetupError";
import { deskListTitleClass } from "@/components/ui/deskChrome";
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
      <h1 className={deskListTitleClass}>Wallet ledger</h1>
      <p className="text-sm text-ink-2">
        Customer billing is packages plus on-demand on{" "}
        <Link href="/admin/packages" className="font-medium text-accent underline-offset-2 hover:underline">
          Packages
        </Link>
        . This page is ops scaffolding: ledger balance, credits, and enforcement mode. Not the owner checkout path.
      </p>
      <AdminWalletsPanel {...overview} />
    </div>
  );
}
