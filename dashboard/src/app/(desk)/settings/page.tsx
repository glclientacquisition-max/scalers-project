import { getCurrentTenant } from "@/lib/tenant";
import { TenantForm } from "@/components/TenantForm";

export default async function SettingsPage() {
  let tenant;
  try {
    tenant = await getCurrentTenant();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load business: {message}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-4xl tracking-tight">Business</h1>
        <p className="mt-3 text-[var(--ink-soft)]">
          No workspace is linked to this account yet. Sign up again or apply{" "}
          <code className="text-sm">docs/supabase/multi_tenant_onboarding.sql</code> and
          contact support.
        </p>
      </div>
    );
  }

  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl tracking-tight">Business</h1>
      <p className="mt-2 text-[var(--ink-soft)]">
        Edit what callers hear about — we compile it into the live AI receptionist prompt.
      </p>

      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <p className="text-sm text-[var(--ink-soft)]">
          DID{" "}
          <span className="font-medium text-[var(--ink)]">
            {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
          </span>
        </p>
        {pendingDid ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            Waiting for a phone number from the pool. Platform ops can assign one under{" "}
            <span className="font-medium">Admin → Businesses</span>.
          </p>
        ) : null}
        <div className="mt-6">
          <TenantForm tenant={tenant} />
        </div>
      </div>
    </div>
  );
}
