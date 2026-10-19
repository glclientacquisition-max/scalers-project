import { ButtonLink } from "@/components/ui/Button";
import { OverviewDataChecksCard } from "@/components/structured/OverviewDataChecksCard";
import { CallInsights } from "@/components/insights/CallInsights";
import { loadCallInsights } from "@/lib/callInsightsLoad";
import { dataChecksFor } from "@/components/structured/StructuredSettingsSlots";
import Link from "next/link";
import { RoleGate } from "@/components/DeskRole";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhenRelative,
  nairobiDateLabel,
  nairobiDayStartIso,
} from "@/lib/callsTriage";
import { inboxRecordHref } from "@/lib/inboxHref";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { assessMvpAnswerReadiness } from "@/lib/mvpAnswerReadiness";
import { lineStatusLabel, resolveLineStatus } from "@/lib/lineStatus";
import {
  deskPreviewClass,
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { liveBulletinItems } from "@/lib/dailyBulletin";
import {
  homeBriefing,
  homeDigestLine,
  homeQueueUnit,
  summarizeInboxWork,
} from "@/lib/inboxPurpose";
import { loadCachedInboxItems } from "@/lib/inboxLoad";
import { nicheCopy, showsHoldQueue, showsVisitQueue } from "@/lib/inboxNiche";
import { visitBoardForDay } from "@/lib/runSheet";
import { eatYmd } from "@/lib/visitCalendar";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { LivePing } from "@/components/ui/deskRow";
import { Stamp } from "@/components/ui/Stamp";
import { HomeCapture } from "@/components/HomeCapture";
import { HomeReviewSettingsNudge } from "@/components/HomeReviewSettingsNudge";
import { HomeCallSetupCard } from "@/components/HomeCallSetupCard";
import { HomeUsageSection } from "@/components/HomeUsageSection";
import { toLocal07 } from "@/lib/callForwarding";
import { loadCallSetupState } from "@/lib/callSetupServer";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";
import { getTenantCompletenessScore, getTenantHoldGate } from "@/lib/deskProvenance";
import { captureFilledDomains } from "@/lib/completenessStub";
import { homeStakes, shopStakes } from "@/lib/baStakes";
import { capabilityGates } from "@/lib/capabilityGates";
import { CapabilityGatesPanel } from "@/components/CapabilityGatesPanel";
import { parseHoursSchedule } from "@/lib/hoursSchedule";
import { isBetaBilling } from "@/lib/wallet";
import { minuteMeter } from "@/lib/minutes";
import { loadOwnerPackageMeter } from "@/lib/packageCatalog";
import { loadOwnerBillingView } from "@/lib/billingStateLoad";
import { lowBalanceNotice } from "@/lib/billingStateModel";
import { messageCreditsUsage } from "@/lib/messageCredits";
import { loadUsageBillingExtras } from "@/lib/ownerPlanLoad";
import { coverageDisplayList } from "@/lib/coverageAreas";
import { homeMinuteStatus } from "@/lib/usageCap";
import { createDeskTimer } from "@/lib/deskTiming";
import { DeskPageGate } from "@/components/DeskPageGate";
import { UNKNOWN_ANSWER_DEFAULT_EN } from "@/lib/unknownAnswerSpoken";
import { deskAssistantSayPage, factSaveIsConfirm } from "@/lib/deskFeatureFlags";
import { HomeGetReadyCallsCard } from "@/components/HomeGetReadyCallsCard";
import { loadReadyChecklist } from "@/lib/assistantSayVoice.server";

export default function HomeOverviewPage() {
  return (
    <DeskPageGate>
      <HomeOverviewBody />
    </DeskPageGate>
  );
}

async function HomeOverviewBody() {
  const timer = createDeskTimer();
  const tenant = await getCurrentTenant();
  timer.mark("tenant");
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const client = workspace.client;
  const dayStart = nairobiDayStartIso();
  const isBeta = isBetaBilling(tenant.billing_enforcement);
  const business = tenant.business_name?.trim() || "your workspace";
  const today = nairobiDateLabel();

  const saveIsConfirm = factSaveIsConfirm();
  const assistantSayPage = deskAssistantSayPage();
  const readyChecklist = assistantSayPage ? await loadReadyChecklist(tenant) : null;
  const overviewChecks = dataChecksFor(tenant, {
    saveIsConfirm,
    readyItems: readyChecklist?.items,
  });

  const readiness = assessMvpAnswerReadiness({
    businessName: tenant.business_name,
    sautikitVirtualNumber: tenant.sautikit_virtual_number,
    llmSystemPrompt: tenant.llm_system_prompt,
    agentName: tenant.agent_name,
    agentTone: tenant.agent_tone,
    businessHours: tenant.business_hours,
    hoursSchedule: tenant.hours_schedule,
    businessLocations: tenant.business_locations,
    faqs: tenant.faqs,
    unknownAnswerFallback: tenant.unknown_answer_fallback || UNKNOWN_ANSWER_DEFAULT_EN,
    whatsappNotificationNumber: tenant.whatsapp_notification_number,
    alertEmail: tenant.alert_email,
    teamDirectory: tenant.team_directory,
    productCatalog: tenant.product_catalog,
    vertical: tenant.vertical,
    agentTools: tenant.agent_tools,
  });
  const line = resolveLineStatus(tenant.sautikit_virtual_number, readiness.ready);
  const vertical = tenant.vertical;
  const copy = nicheCopy(vertical);

  const numberReady = toLocal07(tenant.sautikit_virtual_number) !== null;
  const [todayRes, inbox, billing, extras, score, hold, insights, callSetup] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    loadCachedInboxItems(tenant.id, vertical),
    loadOwnerBillingView(tenant.id),
    loadUsageBillingExtras(tenant.id),
    getTenantCompletenessScore(tenant.id),
    getTenantHoldGate(tenant.id),
    loadCallInsights(client, tenant.id, 30, tenant.faqs),
    numberReady ? loadCallSetupState(tenant.id) : Promise.resolve(null),
  ]);
  const callSetupStatus = callSetup?.supported
    ? resolveCallSetupStatus({ numberReady, setup: callSetup.setup, activity: callSetup.activity, now: Date.now() })
    : null;
  timer.mark("data");
  console.info(timer.line("home"));
  if (inbox.error) {
    return <DeskLoadError>Could not load Overview.</DeskLoadError>;
  }
  // tenant_billing_state first (Ops-Billing #650); tenant counters only before it exists.
  const pack = billing ? null : await loadOwnerPackageMeter(tenant.id);
  const minutesIncluded = billing ? billing.minutesIncluded : pack?.minutesIncluded ?? 0;
  const packMinutes = minuteMeter(pack?.minutesIncluded ?? 0, pack?.secondsUsed ?? 0);
  const minutesLeft = billing ? billing.minutesLeft : packMinutes.left;
  const minutesUnderOne = billing ? billing.minutesUnderOne : packMinutes.underOneMinute;
  const packLabel = billing
    ? billing.shortLabel
    : pack?.packageName
      ? `${pack.packageName}${pack.period ? ` / ${pack.period}` : ""}`
      : "No package";
  const low = billing
    ? lowBalanceNotice(billing, messageCreditsUsage(extras.messageCredits, extras.creditBurns, billing.messageUse))
    : null;
  const lowNotice = low?.lowNotice || null;
  const lowNoticeNote = low?.lowNoticeNote || null;
  const minuteStatus = lowNotice
    ? null
    : homeMinuteStatus({
        isBeta,
        onDemand: Boolean(tenant.on_demand_usage_enabled),
        minutesIncluded,
        minutesLeft,
      });
  const digest = inbox.callsTruncated
    ? null
    : homeDigestLine(inbox.items, dayStart, vertical);

  const todayCount = todayRes.error ? null : todayRes.count ?? 0;
  const work = summarizeInboxWork(inbox.items);
  const gates = capabilityGates(tenant, {
    holdGate: hold,
  });
  const holdsGate = gates.find((g) => g.id === "holds") || null;
  const slotsGate = gates.find((g) => g.id === "booking_slots") || null;
  const todayWork = visitBoardForDay(inbox.items, eatYmd()).length;
  const waitingCount = work.needs;
  const visitQueue = showsVisitQueue(vertical);
  const holdQueue = showsHoldQueue(vertical);
  const briefing = homeBriefing(
    {
      toReturn: work.toReturn,
      toFulfill: holdQueue ? work.toFulfill : 0,
      toConfirm: visitQueue ? work.requested : 0,
    },
    vertical
  );
  const holdSample = work.nextHold?.hold?.when_text || null;
  const jobSample = work.nextJob?.job?.when_text || null;
  const nextReturn = work.nextReturn || null;
  const nextReturnWhen = nextReturn ? formatCallWhenRelative(nextReturn.createdAt) : null;
  const nextReturnReason = nextReturn?.lead?.reason || nextReturn?.headline || null;

  const did = String(tenant.sautikit_virtual_number || "");
  const didDisplay = did.replace(/^\+254(\d{3})(\d{3})(\d{3})$/, "+254 $1 $2 $3");

  const queues = [
    {
      id: "return",
      label: copy.returnCtaMany,
      href: callsHref({ purpose: "human" }),
      count: work.toReturn,
      unit: "",
    },
    ...(holdQueue
      ? [
          {
            id: "hold",
            label: copy.holdFilter,
            href: callsHref({ purpose: "hold" }),
            count: work.toFulfill,
            unit: homeQueueUnit(work.toFulfill, copy.holdUnit, holdSample),
          },
        ]
      : []),
    ...(visitQueue
      ? [
          {
            id: "job",
            label: copy.jobFilter,
            href: callsHref({ purpose: "job" }),
            count: work.toConfirm,
            // Count is every open visit (requested + booked), the same 22 as the
            // Inbox Visits tab. The part still to confirm is named so it matches
            // the briefing ("21 to confirm"): "22 · 21 to confirm".
            unit:
              work.requested > 0 && work.requested === work.toConfirm
                ? homeQueueUnit(work.toConfirm, copy.jobUnit, jobSample)
                : work.requested > 0
                  ? `· ${work.requested} ${copy.jobUnit}`
                  : "",
          },
        ]
      : []),
  ];

  let ctaHref = businessSettingsHref("test");
  let ctaLabel = "Test line";
  const confirmForCta = visitQueue ? work.requested : 0;
  const fulfillForCta = holdQueue ? work.toFulfill : 0;
  if (work.toReturn > confirmForCta && work.toReturn > fulfillForCta) {
    ctaHref = callsHref({ purpose: "human" });
    ctaLabel = work.toReturn === 1 ? copy.returnCtaOne : copy.returnCtaMany;
  } else if (visitQueue && work.requested > 0) {
    ctaHref = callsHref({ purpose: "job" });
    ctaLabel = work.requested === 1 ? copy.jobCtaOne : copy.jobCtaMany;
  } else if (holdQueue && work.toFulfill > 0) {
    ctaHref = callsHref({ purpose: "hold" });
    ctaLabel = work.toFulfill === 1 ? copy.holdCtaOne : copy.holdCtaMany;
  } else if (work.toReturn > 0) {
    ctaHref = callsHref({ purpose: "human" });
    ctaLabel = work.toReturn === 1 ? copy.returnCtaOne : copy.returnCtaMany;
  } else if (visitQueue && todayWork > 0) {
    ctaHref = callsHref({ purpose: "job", view: "today" });
    ctaLabel = "Today";
  } else if (waitingCount > 0) {
    ctaHref = callsHref({ purpose: "needs" });
    ctaLabel = "Needs you";
  } else if (line === "needs_training") {
    ctaHref = businessSettingsHref("train");
    ctaLabel = "Train";
  }

  const returnSidebar =
    ctaLabel === copy.returnCtaOne || ctaLabel === copy.returnCtaMany;
  const showCta = !(line === "pending" && waitingCount === 0) && !returnSidebar;

  return (
    <div className="w-full min-w-0">
      <HomeOverviewHeader today={today} />

      {inbox.partialError ? (
        <div className="mt-6">
          <DeskLoadError>{inbox.partialError}</DeskLoadError>
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-1">
        <section className="min-w-0" aria-labelledby="work-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2
              id="work-heading"
              className="font-display text-title tracking-tight text-ink"
            >
              Work
            </h2>
            <p className={`text-meta text-ink-2 ${deskPreviewClass}`}>{briefing}</p>
          </div>
          {digest ? (
            <p className={`mt-1 text-meta text-ink-2 ${deskPreviewClass}`}>{digest}</p>
          ) : null}

          <ul className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-surface">
            {queues.map((queue, index) => (
              <li
                key={queue.id}
                className={index === 0 ? undefined : "border-t border-hairline"}
              >
                <Link
                  href={queue.href}
                  className={[
                    "flex min-h-12 items-center justify-between gap-3 px-4 text-body font-medium lg:min-h-11",
                    deskShiftClass,
                    "hover:bg-accent/[0.04] active:bg-accent/[0.08]",
                    focusRingVisible,
                  ].join(" ")}
                >
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    <span>{queue.label}</span>
                    {queue.id === "hold" && holdsGate && !holdsGate.allowed ? (
                      <Stamp tone="attention">Needs setup</Stamp>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-3 text-ink-2">
                    <span className={`min-w-0 ${deskPreviewClass}`}>
                      <span className="tabular-nums text-body font-semibold text-ink">
                        {queue.count}
                      </span>
                      {queue.unit ? ` ${queue.unit}` : ""}
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      className="h-4 w-4 shrink-0"
                      aria-hidden
                    >
                      <path
                        d="M7.5 4.5 13 10l-5.5 5.5"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {nextReturn && (nextReturn.callerPhone || nextReturn.callId) ? (
            <>
            <section
              id="next-return-phone"
              aria-labelledby="next-return-heading-phone"
              className="relative mt-3 overflow-hidden rounded-2xl border border-hairline bg-surface lg:hidden"
            >
              <DeskRowHit
                href={nextReturn.callId ? inboxRecordHref(nextReturn.callId, { from: "home" }) : null}
                label="Conversation"
              />
              <div className="flex min-h-12 items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <h2
                    id="next-return-heading-phone"
                    className={`${deskRowMutedClass} text-caption font-semibold text-ink-2`}
                  >
                    Next to return
                  </h2>
                  <p className={`${deskRowMutedClass} mt-0.5 text-body font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
                    {nextReturn.callerName || nextReturn.callerPhone || "Caller"}
                    {nextReturnWhen ? (
                      <span className="font-normal text-ink-2"> · {nextReturnWhen}</span>
                    ) : null}
                  </p>
                  {nextReturnReason ? (
                    <p className={`${deskRowMutedClass} text-body text-ink-2 ${deskPreviewClass}`}>
                      {nextReturnReason}
                    </p>
                  ) : null}
                </div>
                {nextReturn.callerPhone ? (
                  <div className={`${deskRowActionClass} flex shrink-0 items-center`}>
                    <WhatsAppLink
                      number={nextReturn.callerPhone}
                      message={followUpWhatsAppMessage({
                        businessName: business,
                        name: nextReturn.callerName,
                        topic: nextReturn.lead?.topic,
                      })}
                      variant="icon"
                      callId={nextReturn.callId}
                    />
                  </div>
                ) : null}
              </div>
            </section>
            <section
              aria-labelledby="next-return-heading"
              className="relative mt-6 hidden rounded-2xl border border-hairline bg-surface p-4 lg:block"
            >
              <DeskRowHit
                href={nextReturn.callId ? inboxRecordHref(nextReturn.callId, { from: "home" }) : null}
                label="Conversation"
              />
              <h2
                id="next-return-heading"
                className={`${deskRowMutedClass} text-caption font-semibold text-ink-2`}
              >
                Next to return
              </h2>
              <p className={`${deskRowMutedClass} mt-2 text-body font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
                {nextReturn.callerName || nextReturn.callerPhone || "Caller"}
                {nextReturnWhen ? (
                  <span className="font-normal text-ink-2"> · {nextReturnWhen}</span>
                ) : null}
              </p>
              {nextReturnReason ? (
                <p className={`${deskRowMutedClass} mt-0.5 text-body text-ink-2 ${deskPreviewClass}`}>
                  {nextReturnReason}
                </p>
              ) : null}
              {nextReturn.callerPhone ? (
                <div className={`${deskRowActionClass} mt-3 flex items-center`}>
                  <WhatsAppLink
                    number={nextReturn.callerPhone}
                    message={followUpWhatsAppMessage({
                      businessName: business,
                      name: nextReturn.callerName,
                      topic: nextReturn.lead?.topic,
                    })}
                    variant="ghost"
                    label="Reply on WhatsApp"
                    callId={nextReturn.callId}
                  />
                </div>
              ) : null}
            </section>
            </>
          ) : null}
        </section>
        <RoleGate action="settings.edit" mode="hide">
          <HomeCallSetupCard
            tenantId={tenant.id}
            numberReady={numberReady}
            supported={Boolean(callSetup?.supported)}
            status={callSetupStatus}
          />
        </RoleGate>
        {assistantSayPage && readyChecklist && !readyChecklist.allDone ? (
          <HomeGetReadyCallsCard items={readyChecklist.items} checks={overviewChecks} />
        ) : null}
        {!assistantSayPage && overviewChecks.length ? (
          <OverviewDataChecksCard checks={overviewChecks} />
        ) : null}
        {insights ? (
          <CallInsights insights={insights} />
        ) : null}
        {score && line !== "live" && !assistantSayPage ? (
          <HomeCapture
            tenantId={tenant.id}
            vertical={vertical}
            score={score}
            filled={captureFilledDomains(tenant)}
            stakes={
              vertical === "home_services"
                ? homeStakes({
                    services: (tenant.services_catalog || []).map((row) => {
                      const extra = row as {
                        pricing_mode?: string;
                        site_visit_required?: boolean | null;
                      };
                      return {
                        name: row.name,
                        pricing_mode: extra.pricing_mode,
                        site_visit_required: extra.site_visit_required,
                      };
                    }),
                    // Areas served only: where the business is located is not where it goes.
                    // Directory ids ("county:nairobi") become place names; never show the raw id.
                    coverage: coverageDisplayList(tenant.business_policies?.coverage_areas),
                    bookingSlotsAllowed: Boolean(slotsGate?.allowed),
                  })
                : shopStakes({
                    products: tenant.product_catalog || [],
                    schedule: parseHoursSchedule(tenant.hours_schedule),
                    holdsAllowed: Boolean(holdsGate?.allowed),
                  })
            }
          />
        ) : null}
        <CapabilityGatesPanel gates={gates} />
        {score && line === "live" && !score.ready_badge ? (
          <HomeReviewSettingsNudge
            tenantId={tenant.id}
            vertical={vertical}
            score={score}
          />
        ) : null}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            <section aria-label="Today" className="px-3 py-3">
              <Link
                href={callsHref({ purpose: "all" })}
                className={[
                  `flex min-h-11 items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-body text-ink-2 ${deskShiftClass} hover:bg-accent/[0.04] hover:text-ink`,
                  "active:bg-accent/[0.08]",
                  focusRingVisible,
                ].join(" ")}
              >
                <span>Calls today</span>
                {todayCount === null ? null : (
                  <span className="tabular-nums font-medium text-ink">{todayCount}</span>
                )}
              </Link>
            </section>

            <section aria-label="Line" className="border-t border-hairline px-4 py-4">
              <p className="text-body font-medium text-ink">
                {lineStatusLabel(line)}
              </p>
              {line === "live" ? (
                <p className="mt-0.5 truncate font-mono text-meta text-ink-2">
                  {didDisplay || tenant.sautikit_virtual_number}
                </p>
              ) : null}
            </section>

            <RoleGate action="usage.view" mode="hide">
            <HomeUsageSection
              minutesLeft={minutesLeft}
              minutesUnderOne={minutesUnderOne}
              packLabel={packLabel}
              minuteStatus={minuteStatus}
              lowNotice={lowNotice}
              lowNoticeNote={lowNoticeNote}
              showLink={Boolean(lowNotice || (minuteStatus && !isBeta))}
            />
            </RoleGate>

            {showCta ? (
              <div className="border-t border-hairline px-4 py-4">
                <ButtonLink href={ctaHref} className="w-full">
                  {ctaLabel}
                </ButtonLink>
              </div>
            ) : null}
          </div>
        </aside>

        <section
          className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-2"
          aria-labelledby="updates-heading"
        >
          <h2
            id="updates-heading"
            className="flex items-center gap-2 font-display text-title tracking-tight text-ink"
          >
            {liveBulletinItems(tenant.daily_bulletin).length > 0 ? <LivePing /> : null}
            Updates
          </h2>
          <div className="mt-3">
            <DailyBulletinPanel tenant={tenant} />
          </div>
        </section>
      </div>
    </div>
  );
}
