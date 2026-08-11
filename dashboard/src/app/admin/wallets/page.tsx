import { listAdminWallets } from "@/lib/adminWallets";
import { AdminWalletsPanel } from "@/components/AdminWalletsPanel";

export default async function AdminWalletsPage() {
  let overview;
  try {
    overview = await listAdminWallets();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load wallets: {message}
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Apply <code>docs/supabase/wallet_security_beta.sql</code> if columns/RPCs are missing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Wallets</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Manage prepaid balances and beta whitelist. Beta workspaces are metered but not charged.
          Graduating a workspace to prepaid requires confirmation — set the ops actor field to your name
          before credits or plan changes.
        </p>
      </div>
      <AdminWalletsPanel {...overview} />
    </div>
  );
}
