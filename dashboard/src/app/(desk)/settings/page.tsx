import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import {
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
import { listCuratedSonioxVoices, type CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { getCurrentTenant } from "@/lib/tenant";

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
      <div className="min-w-0">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Business
        </p>
        <h1 className="mt-1 font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
          No workspace
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Sign up again or contact support.
        </p>
      </div>
    );
  }

  const params = (await searchParams) || {};
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const panelRaw = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  const tab = parseBusinessSettingsTab(tabRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw);

  let curatedVoices: CuratedSonioxVoice[];
  try {
    curatedVoices = await listCuratedSonioxVoices();
  } catch {
    curatedVoices = [];
  }

  return (
    <BusinessSettingsShell
      tenant={tenant}
      tab={tab}
      trainPanel={trainPanel}
      curatedVoices={curatedVoices}
    />
  );
}
