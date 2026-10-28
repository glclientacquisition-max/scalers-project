import { redirect } from "next/navigation";
import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { SettingsRail } from "@/components/SettingsSideNav";
import { settingsConsoleClass } from "@/components/settingsUi";
import { KbScreen } from "@/components/kb/KbScreen";
import { loadKbState } from "@/lib/kb.server";
import { memberCan } from "@/lib/requireMember";
import { loadSettingsStatuses } from "@/lib/settingsRailStatus";
import { getCurrentTenant } from "@/lib/tenant";

/** v2 Knowledge Base: what you sell, what callers hear, and whether the Business Assistant is ready to use it. */
async function KnowledgeBody() {
  if (!(await memberCan("settings.edit"))) return <DeskNoAccess what="Catalogue" />;
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const [state, statuses] = await Promise.all([loadKbState(tenant.id), loadSettingsStatuses(tenant)]);
  // Before the v2 tables exist (prod until the batch runs) the old Catalogue screen stays the editor.
  if (!state.ok && state.reason === "no_tables") redirect("/settings?tab=catalog");
  if (!state.ok) return <DeskLoadError>Could not load your catalogue.</DeskLoadError>;
  return (
    <div className="w-full min-w-0" data-settings-console="" data-desk-nested="">
      <div className={settingsConsoleClass}>
        <SettingsRail optionStatus={statuses} activePath="/settings/knowledge" />
        <div className="min-w-0 flex-1 md:max-w-2xl" data-kb-screen="">
          <KbScreen
            items={state.items}
            categories={state.categories}
            live={state.live}
            latest={state.latest}
            readiness={state.readiness}
            liveVersion={state.liveVersion}
            readyVersion={state.readyVersion}
          />
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <DeskPageGate>
      <KnowledgeBody />
    </DeskPageGate>
  );
}
