import { redirect } from "next/navigation";
import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { SettingsRail } from "@/components/SettingsSideNav";
import { settingsConsoleClass } from "@/components/settingsUi";
import { KnowledgeCatalogue } from "@/components/catalogue/KnowledgeCatalogue";
import { loadKbState } from "@/lib/kb.server";
import { deskAssistantSayPage, deskKbItemStates } from "@/lib/deskFeatureFlags";
import { memberCan } from "@/lib/requireMember";
import { loadSettingsStatuses } from "@/lib/settingsRailStatus";
import { getCurrentTenant } from "@/lib/tenant";
import { parseVertical } from "@/lib/vertical";
import { loadBrainSettings } from "@/lib/takeMessages.server";

type Search = { filter?: string | string[]; paste?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** v2 Knowledge Base: what you sell, what it costs, and whether calls use it yet. Viewers read it. */
async function KnowledgeBody({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await memberCan("settings.view"))) return <DeskNoAccess what="Catalogue" />;
  const canEdit = await memberCan("settings.edit");
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const search = await searchParams;
  const needPrice = first(search.filter) === "unpriced";
  const [state, statuses, brain] = await Promise.all([
    loadKbState(tenant.id),
    loadSettingsStatuses(tenant),
    loadBrainSettings(tenant.id).catch(() => null),
  ]);
  // Before the v2 tables exist (prod until the batch runs) the old Catalogue screen stays the editor.
  if (!state.ok && state.reason === "no_tables") redirect(`/settings?tab=catalog${needPrice ? "&filter=unpriced" : ""}`);
  if (!state.ok) return <DeskLoadError>Could not load your catalogue.</DeskLoadError>;
  return (
    <div className="w-full min-w-0" data-settings-console="" data-desk-nested="">
      <div className={settingsConsoleClass}>
        <SettingsRail optionStatus={statuses} activePath="/settings/knowledge" assistantSayPage={deskAssistantSayPage()} />
        <div className="min-w-0 flex-1 md:max-w-2xl xl:max-w-desk" data-kb-screen="">
          <KnowledgeCatalogue
            items={state.items}
            categories={state.categories}
            live={state.live}
            latest={state.latest}
            readiness={state.readiness}
            liveVersion={state.liveVersion}
            onCalls={state.onCalls}
            vertical={parseVertical(tenant.vertical)}
            canEdit={canEdit}
            statesEnabled={deskKbItemStates()}
            initialNeedPrice={needPrice}
            initialPaste={first(search.paste) === "1"}
            completeAt={brain ? brain.catalogueCompleteAt : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <DeskPageGate>
      <KnowledgeBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
