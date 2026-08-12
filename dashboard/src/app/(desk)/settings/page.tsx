import { getCurrentTenant } from "@/lib/tenant";
import {
  BusinessSettingsShell,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/components/BusinessSettingsShell";

/** Allow URL fetch + Gemini extract/compile without premature platform cutoffs. */
export const maxDuration = 60;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const params = (await searchParams) || {};
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const panelRaw = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  const tab = parseBusinessSettingsTab(tabRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw);

  return (
    <BusinessSettingsShell tenant={tenant} tab={tab} trainPanel={trainPanel} />
  );
}
