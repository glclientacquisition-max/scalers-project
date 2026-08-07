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
        Teach your receptionist what your business offers — it uses this knowledge on every
        call.
      </p>

      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <p className="text-sm text-[var(--ink-soft)]">
          Your receptionist number{" "}
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

      <section className="mt-6 rounded-2xl border border-[var(--accent)]/30 bg-[#e8f4f1] p-6">
        <h2 className="font-display text-2xl tracking-tight text-[var(--accent-deep)]">
          Test your receptionist
        </h2>
        {pendingDid ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
            Your number is being assigned — you&apos;ll be able to test as soon as it&apos;s
            live.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink)]">
              Call{" "}
              <a
                href={`tel:${tenant.sautikit_virtual_number}`}
                className="font-display text-xl font-medium text-[var(--accent-deep)] underline decoration-[var(--accent)]/40 underline-offset-4"
              >
                {tenant.sautikit_virtual_number}
              </a>{" "}
              from a different phone to hear your new settings live.
            </p>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              Changes apply to new calls right after training. Ask about your services and
              prices to check it answers correctly.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
