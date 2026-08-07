import { listDidPool, listPendingTenants } from "@/lib/didPool";
import { DidPoolManager } from "@/components/DidPoolManager";
import { SautikitSyncButton } from "@/components/SautikitSyncButton";

export default async function AdminNumbersPage() {
  let pool;
  let pendingBusinesses;
  try {
    [pool, pendingBusinesses] = await Promise.all([listDidPool(), listPendingTenants()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load number pool: {message}
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Apply <code>docs/supabase/did_number_pool.sql</code> in the Supabase SQL editor.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-tight">Number pool</h2>
        <SautikitSyncButton />
      </div>
      <p className="mt-1 text-sm text-[var(--ink-soft)] max-w-2xl">
        Spare SautiKit numbers waiting to be given to businesses. A number is either available or
        assigned to exactly one business — never both.
      </p>
      <div className="mt-6">
        <DidPoolManager pool={pool} pendingBusinesses={pendingBusinesses} />
      </div>
    </div>
  );
}
