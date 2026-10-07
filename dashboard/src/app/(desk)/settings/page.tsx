import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import { DESK_MD_COOKIE } from "@/lib/deskMdBoot";
import {
  SETTINGS_NAV,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
  settingsWideDefaultHref,
} from "@/lib/businessSettingsNav";
import { listCuratedSonioxVoices, type CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { serializeFieldMetaForClient } from "@/lib/fieldMetaAttestUi";
import { settingsIndexStatuses } from "@/lib/settingsOptionStatus";
import { tenantForSettingsView } from "@/lib/settingsPanelPayload";
import { getCurrentTenant } from "@/lib/tenant";
import { loadCompileProvenance } from "@/lib/tenantFieldProvenance";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { deskLiveTransferExecutorEnabled } from "@/lib/deskLiveTransfer";
import { DeskPageGate } from "@/components/DeskPageGate";

/** Allow URL fetch + Gemini extract/compile without premature platform cutoffs. */
export const maxDuration = 60;

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default function SettingsPage(props: SettingsPageProps) {
  return (
    <DeskPageGate>
      <SettingsBody {...props} />
    </DeskPageGate>
  );
}

async function SettingsBody({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) || {};
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const panelRaw = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  if (tabRaw === "appearance") redirect("/settings");
  if (!tabRaw) {
    const deskMd = (await cookies()).get(DESK_MD_COOKIE)?.value;
    const wide = settingsWideDefaultHref(tabRaw, deskMd);
    if (wide) redirect(wide);
  }

  let tenant;
  try {
    tenant = await getCurrentTenant();
  } catch {
    return <DeskLoadError>Could not load Settings.</DeskLoadError>;
  }

  if (!tenant) {
    return <DeskNoWorkspace />;
  }
  const tab = parseBusinessSettingsTab(tabRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw, tabRaw);
  const needsVoices = tab === "test" || (tab === "train" && trainPanel === "tools");

  let curatedVoices: CuratedSonioxVoice[] = [];
  if (needsVoices) {
    try {
      curatedVoices = await listCuratedSonioxVoices();
    } catch {
      curatedVoices = [];
    }
  }

  const { fieldMeta: fieldMetaRaw } = await loadCompileProvenance(tenant.id);
  const fieldMeta = serializeFieldMetaForClient(fieldMetaRaw);
  const navTargets = SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target));

  return (
    <BusinessSettingsShell
      tenant={tenantForSettingsView(tenant, tab, trainPanel)}
      tab={tab}
      trainPanel={trainPanel}
      curatedVoices={curatedVoices}
      fieldMeta={fieldMeta}
      optionStatus={settingsIndexStatuses(tenant, curatedVoices, navTargets, fieldMeta)}
      liveTransferExecutor={deskLiveTransferExecutorEnabled()}
    />
  );
}
