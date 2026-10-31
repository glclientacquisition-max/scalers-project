import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { SettingsRail } from "@/components/SettingsSideNav";
import { settingsConsoleClass } from "@/components/settingsUi";
import { AreaPicker, type AreaView } from "@/components/areas/AreaPicker";
import { emptyAreaPicks, moveOverAreas } from "@/lib/areaPicks";
import { loadAreaPicks, pendingOldList } from "@/lib/areaPicks.server";
import { businessHomeCounty } from "@/lib/businessCounty";
import { normalizeBusinessLocations } from "@/lib/businessLocations";
import { memberCan } from "@/lib/requireMember";
import { loadSettingsStatuses } from "@/lib/settingsRailStatus";
import { getCurrentTenant } from "@/lib/tenant";

function parseView(raw: string | undefined): AreaView {
  return raw === "check" || raw === "hear" ? raw : "home";
}

async function AreasBody({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await memberCan("settings.edit"))) return <DeskNoAccess what="Service areas" />;
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const [loaded, statuses] = await Promise.all([loadAreaPicks(tenant.id), loadSettingsStatuses(tenant)]);
  if (!loaded.ok) return <DeskLoadError>Could not load your service areas.</DeskLoadError>;
  const row = loaded.row;
  // With a picks row, coverage_areas is the compat mirror; only moved_from is still "old".
  const oldList = pendingOldList(tenant, row);
  // First visit: start from the moved-over old list; the owner confirms it on Check your areas.
  const initialPicks = row ? row.picks : oldList.length ? moveOverAreas(oldList).picks : emptyAreaPicks();
  const confirmed = Boolean(row?.confirmed_at);
  const homeCounty = businessHomeCounty(
    normalizeBusinessLocations((tenant as { business_locations?: unknown }).business_locations),
  );
  let view = parseView((await searchParams).view);
  if (view === "home" && !row && oldList.length) view = "check";
  if (view === "check" && !oldList.length) view = "home";
  return (
    <div className="w-full min-w-0 overflow-x-clip" data-settings-console="" data-desk-nested="">
      <div className={settingsConsoleClass}>
        <SettingsRail optionStatus={statuses} activePath="/settings/areas" />
        <div className="min-w-0 flex-1 md:max-w-2xl" data-area-picker="">
          <AreaPicker initialPicks={initialPicks} oldList={oldList} confirmed={confirmed} initialView={view} homeCounty={homeCounty} />
        </div>
      </div>
    </div>
  );
}

export default function AreasPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return (
    <DeskPageGate>
      <AreasBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
