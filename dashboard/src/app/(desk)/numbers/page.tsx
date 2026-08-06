import { redirect } from "next/navigation";
import { isLegacyAuthenticated } from "@/lib/auth";
import { listDidPool, listPendingTenants } from "@/lib/didPool";
import { DidPoolManager } from "@/components/DidPoolManager";

export default async function NumbersPage() {
  if (!(await isLegacyAuthenticated())) {
    redirect("/calls");
  }

  let pool;
  let pendingTenants;
  try {
    [pool, pendingTenants] = await Promise.all([listDidPool(), listPendingTenants()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="max-w-3xl">
        <h1 className="font-display text-4xl tracking-tight">DID pool</h1>
        <p className="mt-4 rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
          Could not load pool: {message}
          <br />
          <span className="text-sm text-[var(--ink-soft)]">
            Apply <code>docs/supabase/did_number_pool.sql</code> in the Supabase SQL editor.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-4xl tracking-tight">DID pool</h1>
      <p className="mt-2 text-[var(--ink-soft)] max-w-2xl">
        Ops-only. Seed unused SautiKit numbers here so new signups (and pending tenants) get a
        live DID automatically.
      </p>
      <div className="mt-8">
        <DidPoolManager pool={pool} pendingTenants={pendingTenants} />
      </div>
    </div>
  );
}
