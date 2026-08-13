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
      <h1 className="font-display text-3xl tracking-tight">Wallets</h1>
      <AdminWalletsPanel {...overview} />
    </div>
  );
}
