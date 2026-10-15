import { memberCan } from "@/lib/requireMember";
import { structuredSettingsSlots } from "@/components/structured/StructuredSettingsSlots";
import { readBusinessType } from "@/lib/structuredServer";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { MembersLoadError, MembersPanel } from "@/components/MembersPanel";
import { loadMembers } from "@/lib/membersLoad";
import { currentMemberRole } from "@/lib/requireMember";
import { teamInvitesEnabled } from "@/lib/teamInvitesFlag";
import { can } from "@/lib/permissions";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import {
  SETTINGS_NAV,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
import { listCuratedSonioxVoices, type CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { settingsIndexStatuses } from "@/lib/settingsOptionStatus";
import { tenantForSettingsView } from "@/lib/settingsPanelPayload";
import { getCurrentTenant } from "@/lib/tenant";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { deskLiveTransferExecutorEnabled } from "@/lib/deskLiveTransfer";
import { DeskPageGate } from "@/components/DeskPageGate";
import { smartImportEnabled } from "@/lib/smartImport/flag";

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
  if (!(await memberCan("settings.view"))) return <DeskNoAccess what="Settings" />;
  const params = (await searchParams) || {};
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const panelRaw = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  if (tabRaw === "appearance") redirect("/settings");

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

  // Team & access: Members (logins, paid seats) when the feature flag is on.
  let membersSlot = null;
  if (tab === "train" && trainPanel === "team" && teamInvitesEnabled(tenant.id)) {
    const [role, user] = await Promise.all([currentMemberRole(), getAuthUser()]);
    if (role && user && can(role, "members.view")) {
      try {
        const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const data = await loadMembers(tenant.id, { members: one(params.members), invites: one(params.invites) });
        membersSlot = <MembersPanel data={data} viewerRole={role} viewerId={user.id} />;
      } catch {
        membersSlot = <MembersLoadError />;
      }
    }
  }

  // Typed data (payments, price checks, category). The columns may not exist before the migration: then null.
  let structuredSlot = null;
  // Catalogue is its own tab (?tab=catalog), not a train panel: the old check never showed its price cards.
  if (tab === "catalog" || (tab === "train" && trainPanel === "identity")) {
    const [canEdit, typed] = await Promise.all([memberCan("settings.edit"), readBusinessType(tenant.id)]);
    structuredSlot = structuredSettingsSlots({
      tenant,
      canEdit,
      businessType: typed?.business_type || (tenant.vertical === "home_services" || tenant.vertical === "retail" ? tenant.vertical : "general"),
      businessCategory: typed?.business_category ?? null,
    });
  }

  const navTargets = SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target));

  return (
    <BusinessSettingsShell
      tenant={tenantForSettingsView(tenant, tab, trainPanel)}
      tab={tab}
      trainPanel={trainPanel}
      curatedVoices={curatedVoices}
      optionStatus={settingsIndexStatuses(tenant, curatedVoices, navTargets)}
      liveTransferExecutor={deskLiveTransferExecutorEnabled()}
      membersSlot={membersSlot}
      structuredSlot={structuredSlot}
      smartImport={smartImportEnabled()}
    />
  );
}
