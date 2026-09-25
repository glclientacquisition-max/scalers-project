import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import {
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
import { listCuratedSonioxVoices, type CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { getCurrentTenant } from "@/lib/tenant";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { deskLiveTransferExecutorEnabled } from "@/lib/deskLiveTransfer";

// instant = false: request-time desk data under the owner auth shell.
export const instant = false;

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
  } catch {
    return <DeskError>Could not load Business Profile.</DeskError>;
  }

  if (!tenant) {
    return <DeskNoWorkspace />;
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
      liveTransferExecutor={deskLiveTransferExecutorEnabled()}
    />
  );
}
