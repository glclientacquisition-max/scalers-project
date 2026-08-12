import { getCurrentTenant } from "@/lib/tenant";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import {
  parseSettingsTab,
  parseSettingsTrainPanel,
} from "@/lib/settingsNav";

/** Allow URL fetch + Gemini extract/compile without premature platform cutoffs. */
export const maxDuration = 60;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; panel?: string }>;
}) {
  const sp = await searchParams;
  const tab = parseSettingsTab(sp.tab);
  const trainPanel = parseSettingsTrainPanel(sp.panel);

  let tenant;
  try {
    tenant = await getCurrentTenant();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Could not load business: {message}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-4xl tracking-tight">Business</h1>
        <p className="mt-3 text-ink-soft">
          No workspace is linked to this account yet. Sign up again or apply{" "}
          <code className="text-sm">docs/supabase/multi_tenant_onboarding.sql</code> and
          contact support.
        </p>
      </div>
    );
  }

  return (
    <BusinessSettingsShell
      tenant={tenant}
      tab={tab}
      trainPanel={trainPanel}
    />
  );
}
