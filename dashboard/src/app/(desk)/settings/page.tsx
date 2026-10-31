import { memberCan } from "@/lib/requireMember";

/** Voice lookup on assistant-say uses runtime clock; opt out of static prerender. */
export const instant = false;
import { structuredSettingsSlots } from "@/components/structured/StructuredSettingsSlots";
import { readBusinessType } from "@/lib/structuredServer";
import { readGreetingLanguage } from "@/lib/identityGreetingServer";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { MembersLoadError, MembersPanel } from "@/components/MembersPanel";
import { loadMembers } from "@/lib/membersLoad";
import { currentMemberRole } from "@/lib/requireMember";
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
import { settingsViewReadsCatalogue, tenantForSettingsView } from "@/lib/settingsPanelPayload";
import { loadKbCatalogueView } from "@/lib/kbRead.server";
import { getCurrentTenant } from "@/lib/tenant";
import { kbTablesReady } from "@/lib/kb.server";
import { resolveTenantBusinessType } from "@/lib/businessType";
import { loadPlanRowStatus } from "@/lib/ownerPlanLoad";
import { loadSeatCount } from "@/lib/billingStateLoad";
import { planEntry } from "@/lib/planEntry";
import { TeamSeatsNote } from "@/components/plan/TeamSeatsNote";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { deskLiveTransferExecutorEnabled } from "@/lib/deskLiveTransfer";
import { Suspense } from "react";
import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskPageSkeleton } from "@/components/DeskPageSkeleton";
import { deskAssistantSayPage } from "@/lib/deskFeatureFlags";
import { loadAssistantSayView } from "@/lib/assistantSayVoice.server";
import { readPronunciationReviewQueue } from "@/app/(desk)/settings/pronunciationGeminiScanActions";
import type { PronunciationReviewCandidate } from "@/lib/pronunciationGeminiScan";
import { loadKbGreetingPreview } from "@/lib/kbCaller.server";
import { AssistantSayPanel } from "@/components/assistantSay/AssistantSayPanel";
import { parseUnknownAnswerByKind } from "@/lib/unknownAnswerByKindConstants";
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
  // Params first (no fetch), then role and row together, not one after another.
  const params = (await searchParams) || {};
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const panelRaw = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  if (tabRaw === "appearance") redirect("/settings");
  const [canView, loaded] = await Promise.all([
    memberCan("settings.view"),
    getCurrentTenant().then(
      (row) => ({ ok: true as const, row }),
      () => ({ ok: false as const, row: null })
    ),
  ]);
  if (!canView) return <DeskNoAccess what="Settings" />;

  if (!loaded.ok) return <DeskLoadError>Could not load Settings.</DeskLoadError>;
  let tenant = loaded.row;

  if (!tenant) {
    return <DeskNoWorkspace />;
  }
  const planRowPromise = loadPlanRowStatus(tenant.id);
  const callSetupPromise = loadCallSetupState(tenant.id);
  const tab = parseBusinessSettingsTab(tabRaw, panelRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw, tabRaw);
  // The Import tab is gone: old ?tab=import links open Add many on the Catalogue.
  if (tab === "import") redirect("/settings/knowledge?many=1");
  // KB v2 businesses edit the catalogue on /settings/knowledge. The old Catalogue tab would write the
  // retired catalogue columns, so send owners across.
  if (tab === "catalog" && (await kbTablesReady(tenant.id))) {
    const unpriced = (Array.isArray(params.filter) ? params.filter[0] : params.filter) === "unpriced";
    redirect(`/settings/knowledge${unpriced ? "?filter=unpriced" : ""}`);
  }
  const assistantSayPage = deskAssistantSayPage();
  const topicRaw = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  if (tab === "assistant-say" && !assistantSayPage) redirect("/settings");
  // The voice picker lives on Identity (How you answer); Voice links there.
  const needsVoices =
    tab === "test" || (tab === "train" && (trainPanel === "tools" || trainPanel === "identity"));

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

  // Team & access: Members (logins, paid seats). Mutations stay gated in membersActions when invites are off.
  let membersSlot = null;
  if (teamPanel) {
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
  let businessCategory: string | null = null;
  // Catalogue is its own tab (?tab=catalog), not a train panel: the old check never showed its price cards.
  if (tab === "catalog" || (tab === "train" && trainPanel === "identity")) {
    const identity = tab === "train" && trainPanel === "identity";
    const [canEdit, typed, greeting] = await Promise.all([
      memberCan("settings.edit"),
      readBusinessType(tenant.id),
      identity ? readGreetingLanguage(tenant.id) : Promise.resolve(null),
    ]);
    // How you answer shows the stored greeting language (Automatic when null).
    if (greeting) tenant = { ...tenant, ...greeting };
    structuredSlot = structuredSettingsSlots({
      tenant,
      canEdit,
      businessType: resolveTenantBusinessType({
        business_type: typed?.business_type,
        vertical: tenant.vertical,
      }),
      businessCategory: typed?.business_category ?? null,
    });
    businessCategory = typed?.business_category ?? null;
  }

  let assistantSaySlot = null;
  if (tab === "assistant-say" && assistantSayPage) {
    try {
      // isKbLive: rows and samples read the published snapshot (what callers hear now); else the stored row.
      const view = await loadAssistantSayView(tenant);
      const businessType = resolveTenantBusinessType(tenant);
      assistantSaySlot = (
        <AssistantSayPanel
          state={view.state}
          pending={view.pending}
          samples={view.samples}
          tenant={tenant}
          businessType={businessType}
          initialTopic={topicRaw}
          initialByKind={parseUnknownAnswerByKind(tenant.unknown_answer_by_kind)}
          legacyGeneral={tenant.unknown_answer_fallback}
        />
      );
    } catch {
      assistantSaySlot = <DeskLoadError>Could not load what callers hear.</DeskLoadError>;
    }
  }

  let callsSlot = null;
  if (tab === "calls") {
    const number = toLocal07(tenant.sautikit_virtual_number);
    const state = number ? await callSetupPromise : null;
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

  let pronunciationReview: PronunciationReviewCandidate[] = [];
  let pronunciationQueueFailed = false;
  if (tab === "train" && trainPanel === "pronunciation") {
    const read = await readPronunciationReviewQueue();
    if (read.ok) {
      pronunciationReview = [...read.queue, ...read.sttHints];
    } else {
      pronunciationQueueFailed = true;
    }
  }

  const navTargets = SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target));
  const [planRow, callSetup] = await Promise.all([planRowPromise, callSetupPromise]);
  const planStatus: Record<string, SettingsListStatus> = {
    ...(planRow.row ? { "/settings/plan": planRow.row } : {}),
    ...(planRow.billingRow ? { "/settings/billing": planRow.billingRow } : {}),
  };

  // Test panel greeting preview and the catalogue view read kb_items when the KB tables exist (stored columns otherwise).
  // isKbLive with a readable snapshot: the Test greeting preview uses the call's snapshot greeting; else legacy reads.
  const readsCatalogue = settingsViewReadsCatalogue(tab, trainPanel);
  const [kbView, kbGreeting] = readsCatalogue
    ? await Promise.all([loadKbCatalogueView(tenant.id, tenant), loadKbGreetingPreview(tenant)])
    : [null, null];
  const kbCatalogue = kbView && kbGreeting ? { ...kbView, offering_line: kbGreeting.offeringLine, pending: kbGreeting.pending } : kbView;
  return (
    <Suspense fallback={<DeskPageSkeleton />}>
      <BusinessSettingsShell
        tenant={tenantForSettingsView(tenant, tab, trainPanel, kbCatalogue)}
        tab={tab}
        trainPanel={trainPanel}
        curatedVoices={curatedVoices}
        optionStatus={{
          ...settingsIndexStatuses(
            { ...tenant, call_option: callSetup.supported ? (callSetup.setup?.option ?? null) : undefined },
            curatedVoices,
            navTargets,
          ),
          ...planStatus,
        }}
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
        businessCategory={businessCategory}
        pronunciationReview={pronunciationReview}
        pronunciationQueueFailed={pronunciationQueueFailed}
      />
    </Suspense>
  );
}
