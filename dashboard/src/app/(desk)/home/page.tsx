import { ButtonLink } from "@/components/ui/Button";
import Link from "next/link";
import { RoleGate } from "@/components/DeskRole";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  nairobiDateLabel,
  nairobiDayStartIso,
} from "@/lib/callsTriage";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { assessMvpAnswerReadiness } from "@/lib/mvpAnswerReadiness";
import { lineStatusLabel, resolveLineStatus } from "@/lib/lineStatus";
import { StatusMark, type StatusIcon, type StatusTone } from "@/components/ui/StatusMark";
import { CallerCards } from "@/components/home/CallerCards";
import { UpdateStatus } from "@/components/home/UpdateStatus";
import { splitOutcomes } from "@/lib/todayOutcomes";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { homeDigestLine, summarizeInboxWork } from "@/lib/inboxPurpose";
import { loadCachedInboxItems } from "@/lib/inboxLoad";
import { nicheCopy, showsHoldQueue, showsVisitQueue } from "@/lib/inboxNiche";
import { visitBoardForDay } from "@/lib/runSheet";
import { eatYmd } from "@/lib/visitCalendar";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { HomeCapture } from "@/components/HomeCapture";
import { toLocal07 } from "@/lib/callForwarding";
import { getTenantCompletenessScore, getTenantHoldGate } from "@/lib/deskProvenance";
import { captureFilledDomains } from "@/lib/completenessStub";
import { homeStakes, shopStakes } from "@/lib/baStakes";
import { capabilityGates } from "@/lib/capabilityGates";
import { parseHoursSchedule } from "@/lib/hoursSchedule";
import { isBetaBilling } from "@/lib/wallet";
import { coverageDisplayList } from "@/lib/coverageAreas";
import { createDeskTimer } from "@/lib/deskTiming";
import { DeskPageGate } from "@/components/DeskPageGate";
import { UNKNOWN_ANSWER_DEFAULT_EN } from "@/lib/unknownAnswerSpoken";
import { deskAssistantSayPage } from "@/lib/deskFeatureFlags";
import { Suspense } from "react";
import {
  HomeCallSetupSlot,
  HomeChecksSlot,
  HomeInsightsSlot,
  HomeUsageSlot,
} from "@/components/home/HomeOverviewSlots";
import {
  HomeInsightsSkeleton,
  HomeSkeleton,
  HomeUsageSkeleton,
} from "@/components/home/HomeOverviewSkeletons";
import { memberCan } from "@/lib/requireMember";

export default function HomeOverviewPage() {
  return (
    <DeskPageGate fallback={<HomeSkeleton />}>
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

  // Only what the Work list, Today and Line need waits here. Usage, insights,
  // call setup and checks stream in their own Suspense slots below (D2).
  const [workspace, canEditSettings] = await Promise.all([
    createWorkspaceDataClient(),
    memberCan("settings.edit"),
  ]);
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const client = workspace.client;
  const dayStart = nairobiDayStartIso();
  const isBeta = isBetaBilling(tenant.billing_enforcement);
  const business = tenant.business_name?.trim() || "your workspace";
  const today = nairobiDateLabel();

  const assistantSayPage = deskAssistantSayPage();

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
  const linePill: { tone: StatusTone; icon: StatusIcon; word: string } =
    line === "live"
      ? { tone: "ok", icon: "check", word: "Live" }
      : line === "pending"
        ? { tone: "neutral", icon: "clock", word: "Number pending" }
        : { tone: "warn", icon: "tri", word: "Needs training" };
  const vertical = tenant.vertical;
  const copy = nicheCopy(vertical);

  const numberReady = toLocal07(tenant.sautikit_virtual_number) !== null;
  const [todayRes, inbox, score, hold, factsRes] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    loadCachedInboxItems(tenant.id, vertical),
    getTenantCompletenessScore(tenant.id),
    getTenantHoldGate(tenant.id),
    client
      .from("call_facts")
      .select("outcome")
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart)
      .in("source", ["review", "owner"]),
  ]);
  timer.mark("data");
  console.info(timer.line("home"));
  if (inbox.error) {
    return <DeskLoadError>Could not load Overview.</DeskLoadError>;
  }
  void (inbox.callsTruncated ? null : homeDigestLine(inbox.items, dayStart, vertical));

  const todayCount = todayRes.error ? null : todayRes.count ?? 0;
  const todaySplit = factsRes.error ? null : splitOutcomes((factsRes.data || []).map((row) => row.outcome as string | null));
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
  const nextReturn = work.nextReturn || null;
  const gatesOff = gates.filter((gate) => !gate.allowed);

  const did = String(tenant.sautikit_virtual_number || "");
  const didDisplay = did.replace(/^\+254(\d{3})(\d{3})(\d{3})$/, "+254 $1 $2 $3");

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

      <div className="mt-6 flex w-full flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
        <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
          <section aria-label="Line" className="px-4 py-4">
            <h2 className="sr-only">{lineStatusLabel(line)}</h2>
            <StatusMark tone={linePill.tone} icon={linePill.icon}>{linePill.word}</StatusMark>
            {line === "live" ? (
              <p className="mt-2 truncate font-mono text-body text-ink">
                {didDisplay || tenant.sautikit_virtual_number}
              </p>
            ) : (
              <p className="mt-2 text-body text-ink-2">
                {line === "pending" ? "Your number is not live yet." : "Train the line before it can answer."}
              </p>
            )}
          </section>

          {line === "live" ? (
            <div className="grid grid-cols-3 gap-2 border-t border-hairline px-4 py-3" aria-label="Today">
              {(
                [
                  { label: "Calls", value: todayCount, href: callsHref({ purpose: "all" }) },
                  { label: "Need you", value: work.toReturn, href: callsHref({ purpose: "human" }) },
                  { label: "Visits", value: visitQueue ? work.toConfirm : 0, href: callsHref({ purpose: "job" }) },
                ] as const
              ).map((tile) => (
                <Link
                  key={tile.label}
                  href={tile.href}
                  className={`flex min-h-12 flex-col justify-center rounded-xl bg-canvas px-2 ${focusRingVisible}`}
                >
                  <span className="tabular-nums text-title font-semibold text-ink">
                    {tile.value === null ? "Failed" : tile.value}
                  </span>
                  <span className="text-meta text-ink-2">{tile.label}</span>
                </Link>
              ))}
            </div>
          ) : null}
          {todayCount === null ? (
            <Link href="/home" className={`inline-flex min-h-11 items-center px-4 text-body font-medium text-accent ${focusRingVisible}`}>Retry</Link>
          ) : null}

          {showCta ? (
            <div className="border-t border-hairline px-4 py-4">
              <ButtonLink href={ctaHref} className="w-full">
                {ctaLabel}
              </ButtonLink>
            </div>
          ) : null}
        </div>

        <CallerCards
          items={inbox.callsTruncated ? [] : inbox.items}
          dayStart={dayStart}
          pinId={nextReturn?.id ?? null}
          lineLive={line === "live"}
          factsFailed={todaySplit == null}
        />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-4">
          <RoleGate action="usage.view" mode="hide">
            <Suspense fallback={<HomeUsageSkeleton />}>
              <HomeUsageSlot tenant={tenant} isBeta={isBeta} />
            </Suspense>
          </RoleGate>
          <Suspense fallback={<HomeInsightsSkeleton />}>
            <HomeInsightsSlot client={client} tenant={tenant} />
          </Suspense>
        </div>
      </div>

      <div className="mt-6 flex w-full flex-col gap-6">
        <UpdateStatus tenant={tenant} />

        {gatesOff.length > 0 ? (
          <section className="rounded-2xl border border-hairline bg-warn-soft px-4 py-3" aria-label="Assistant setup">
            <p className="text-body text-ink">
              {gatesOff.length === 1 ? `${gatesOff[0]?.title ?? "One thing"} is off.` : `${gatesOff.length} things are off.`}
            </p>
            <Link href={businessSettingsHref("capabilities")} className={`mt-1 inline-flex min-h-11 items-center text-body font-medium text-accent ${focusRingVisible}`}>
              Open settings
            </Link>
          </section>
        ) : null}

        <Suspense fallback={null}>
          <HomeCallSetupSlot tenantId={tenant.id} numberReady={numberReady} />
        </Suspense>
        <Suspense fallback={null}>
          <HomeChecksSlot
            tenant={tenant}
            canEditSettings={canEditSettings}
            review={score && line === "live" && !score.ready_badge ? { tenantId: tenant.id, vertical, score } : null}
          />
        </Suspense>
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
      </div>
    </div>
  );
}
