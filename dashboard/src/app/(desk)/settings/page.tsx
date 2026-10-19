import { memberCan } from "@/lib/requireMember";

/** Voice lookup on assistant-say uses runtime clock; opt out of static prerender. */
export const instant = false;
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
import { settingsIndexStatuses, type SettingsListStatus } from "@/lib/settingsOptionStatus";
import { tenantForSettingsView } from "@/lib/settingsPanelPayload";
import { getCurrentTenant } from "@/lib/tenant";
import { loadPlanRowStatus } from "@/lib/ownerPlanLoad";
import { loadSeatCount } from "@/lib/billingStateLoad";
import { planEntry } from "@/lib/planEntry";
import { TeamSeatsNote } from "@/components/plan/TeamSeatsNote";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { deskLiveTransferExecutorEnabled } from "@/lib/deskLiveTransfer";
import { DeskPageGate } from "@/components/DeskPageGate";
import { deskAssistantSayPage } from "@/lib/deskFeatureFlags";
import { loadAssistantSayState } from "@/lib/assistantSayVoice.server";
import { AssistantSayPanel } from "@/components/assistantSay/AssistantSayPanel";
import { assistantSayBelowList } from "@/components/assistantSay/AssistantSayExtras";
import { CallsForwardingPanel } from "@/components/CallsForwardingPanel";
import { loadCallSetupState } from "@/lib/callSetupServer";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";
import { toLocal07 } from "@/lib/callForwarding";
import { formatKenyaNumber } from "@/lib/setupFlow";

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
  const planRowPromise = loadPlanRowStatus(tenant.id);
  const tab = parseBusinessSettingsTab(tabRaw, panelRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw, tabRaw);
  const assistantSayPage = deskAssistantSayPage();
  if (tab === "assistant-say" && !assistantSayPage) redirect("/settings");
  const needsVoices = tab === "test" || (tab === "train" && trainPanel === "tools");

  let curatedVoices: CuratedSonioxVoice[] = [];
  if (needsVoices) {
    try {
      curatedVoices = await listCuratedSonioxVoices();
    } catch {
      curatedVoices = [];
    }
  }

  // Team: seats full gets one note. Alert contacts never use a seat.
  const teamPanel = tab === "train" && trainPanel === "team";
  const [seatCount, planRowNow, canBilling] = teamPanel
    ? await Promise.all([loadSeatCount(tenant.id), planRowPromise, memberCan("billing.manage")])
    : [null, null, false];
  const teamEntry = planRowNow ? planEntry(planRowNow.billingStatus, canBilling) : null;
  const seatsFull = Boolean(seatCount && seatCount.included > 0 && seatCount.used >= seatCount.included);

  // Team & access: Members (logins, paid seats) when the feature flag is on.
  let membersSlot = null;
  if (teamPanel && teamInvitesEnabled(tenant.id)) {
    const [role, user] = await Promise.all([currentMemberRole(), getAuthUser()]);
    if (role && user && can(role, "members.view")) {
      try {
        const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const data = await loadMembers(tenant.id, { members: one(params.members), invites: one(params.invites) });
        membersSlot = <MembersPanel data={data} viewerRole={role} viewerId={user.id} planEntry={teamEntry} />;
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

  let assistantSaySlot = null;
  if (tab === "assistant-say" && assistantSayPage) {
    const state = await loadAssistantSayState(tenant);
    assistantSaySlot = <AssistantSayPanel state={state} belowList={assistantSayBelowList(tenant)} />;
  }

  let callsSlot = null;
  if (tab === "calls") {
    const number = toLocal07(tenant.sautikit_virtual_number);
    const state = number ? await loadCallSetupState(tenant.id) : null;
    const status = resolveCallSetupStatus({
      numberReady: Boolean(number),
      setup: state?.setup ?? null,
      activity: state?.activity ?? null,
      now: Date.now(),
    });
    callsSlot = (
      <CallsForwardingPanel
        tenantId={tenant.id}
        number={number}
        pretty={formatKenyaNumber(tenant.sautikit_virtual_number)}
        supported={Boolean(state?.supported)}
        setup={state?.setup ?? null}
        status={status}
      />
    );
  }

  const navTargets = SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target));
  const planRow = await planRowPromise;
  const planStatus: Record<string, SettingsListStatus> = planRow.row ? { "/settings/plan": planRow.row } : {};

  return (
    <BusinessSettingsShell
      tenant={tenantForSettingsView(tenant, tab, trainPanel)}
      tab={tab}
      trainPanel={trainPanel}
      curatedVoices={curatedVoices}
      optionStatus={{ ...settingsIndexStatuses(tenant, curatedVoices, navTargets), ...planStatus }}
      liveTransferExecutor={deskLiveTransferExecutorEnabled()}
      membersSlot={membersSlot}
      seatNoteSlot={
        teamPanel && seatsFull && !membersSlot && seatCount ? (
          <TeamSeatsNote included={seatCount.included} entry={teamEntry} />
        ) : null
      }
      structuredSlot={structuredSlot}
      callsSlot={callsSlot}
      assistantSaySlot={assistantSaySlot}
      assistantSayPage={assistantSayPage}
    />
  );
}
