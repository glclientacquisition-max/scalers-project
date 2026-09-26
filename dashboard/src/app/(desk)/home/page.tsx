import Link from "next/link";
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
  btnPrimary,
  deskPreviewClass,
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import {
  homeBriefing,
  homeDigestLine,
  homeQueueUnit,
  summarizeInboxWork,
} from "@/lib/inboxPurpose";
import { loadCachedInboxItems } from "@/lib/inboxLoad";
import { nicheCopy } from "@/lib/inboxNiche";
import { visitBoardForDay } from "@/lib/runSheet";
import { eatYmd } from "@/lib/visitCalendar";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { LivePing } from "@/components/ui/deskRow";
import { isBetaBilling } from "@/lib/wallet";
import { loadOwnerPackageMeter, remainingCount } from "@/lib/packageCatalog";

// instant = false: request-time desk data under the owner auth shell.
export const instant = false;

export default async function HomeOverviewPage() {
  const tenant = await getCurrentTenant();
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
    unknownAnswerFallback: tenant.unknown_answer_fallback,
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

  const [todayRes, inbox, pack] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    loadCachedInboxItems(tenant.id, vertical),
    loadOwnerPackageMeter(tenant.id),
  ]);
  if (inbox.error) {
    return <DeskError>Could not load Overview.</DeskError>;
  }
  const minutesLeft = remainingCount(pack.minutesIncluded, pack.minutesUsed);
  const packLabel = pack.packageName
    ? `${pack.packageName}${pack.period ? ` / ${pack.period}` : ""}`
    : "No package";
  const minutesExhausted = pack.minutesIncluded > 0 && minutesLeft <= 0;
  const digest = inbox.callsTruncated
    ? null
    : homeDigestLine(inbox.items, dayStart, vertical);

  const todayCount = todayRes.error ? null : todayRes.count ?? 0;
  const work = summarizeInboxWork(inbox.items);
  const todayWork = visitBoardForDay(inbox.items, eatYmd()).length;
  const waitingCount = work.needs;
  const briefing = homeBriefing(
    {
      toReturn: work.toReturn,
      toFulfill: work.toFulfill,
      toConfirm: work.toConfirm,
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
    {
      id: "hold",
      label: copy.holdFilter,
      href: callsHref({ purpose: "hold" }),
      count: work.toFulfill,
      unit: homeQueueUnit(work.toFulfill, copy.holdUnit, holdSample),
    },
    {
      id: "job",
      label: copy.jobFilter,
      href: callsHref({ purpose: "job" }),
      count: work.toConfirm,
      unit: homeQueueUnit(work.toConfirm, copy.jobUnit, jobSample),
    },
  ] as const;

  let ctaHref = businessSettingsHref("test");
  let ctaLabel = "Test line";
  if (work.toConfirm > 0) {
    ctaHref = callsHref({ purpose: "job" });
    ctaLabel = work.toConfirm === 1 ? copy.jobCtaOne : copy.jobCtaMany;
  } else if (work.toFulfill > 0) {
    ctaHref = callsHref({ purpose: "hold" });
    ctaLabel = work.toFulfill === 1 ? copy.holdCtaOne : copy.holdCtaMany;
  } else if (work.toReturn > 0) {
    ctaHref = callsHref({ purpose: "human" });
    ctaLabel = work.toReturn === 1 ? copy.returnCtaOne : copy.returnCtaMany;
  } else if (todayWork > 0) {
    ctaHref = callsHref({ purpose: "job", view: "today" });
    ctaLabel = "Today";
  } else if (line === "needs_training") {
    ctaHref = businessSettingsHref("train");
    ctaLabel = "Train";
  }

  const showCta = !(line === "pending" && waitingCount === 0);

  return (
    <div className="w-full min-w-0">
      <HomeOverviewHeader business={business} today={today} />

      {inbox.partialError ? (
        <div className="mt-6">
          <DeskError>{inbox.partialError}</DeskError>
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-7">
        <section className="min-w-0" aria-labelledby="work-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2
              id="work-heading"
              className="font-display text-xl tracking-tight text-ink"
            >
              Work
            </h2>
            <p className={`text-[13px] text-ink-soft ${deskPreviewClass}`}>{briefing}</p>
          </div>
          {digest ? (
            <p className={`mt-1 text-[13px] text-ink-soft ${deskPreviewClass}`}>{digest}</p>
          ) : null}

          <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
            {queues.map((queue, index) => (
              <li
                key={queue.id}
                className={index === 0 ? undefined : "border-t border-line"}
              >
                <Link
                  href={queue.href}
                  className={[
                    "flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium lg:min-h-11",
                    deskShiftClass,
                    "hover:bg-accent/[0.04] active:bg-accent/[0.08]",
                    focusRingVisible,
                  ].join(" ")}
                >
                  <span className="text-ink">{queue.label}</span>
                  <span className="flex min-w-0 items-center gap-3 text-ink-soft">
                    <span className={`min-w-0 ${deskPreviewClass}`}>
                      <span className="tabular-nums text-base font-semibold text-ink">
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
              className="relative mt-3 overflow-hidden rounded-2xl border border-line bg-surface lg:hidden"
            >
              <DeskRowHit
                href={nextReturn.callId ? inboxRecordHref(nextReturn.callId, { purpose: "needs" }) : null}
                label="Conversation"
              />
              <div className="flex min-h-12 items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <h2
                    id="next-return-heading-phone"
                    className={`${deskRowMutedClass} text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft`}
                  >
                    Next to return
                  </h2>
                  <p className={`${deskRowMutedClass} mt-0.5 text-sm font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
                    {nextReturn.callerName || nextReturn.callerPhone || "Caller"}
                    {nextReturnWhen ? (
                      <span className="font-normal text-ink-soft"> · {nextReturnWhen}</span>
                    ) : null}
                  </p>
                  {nextReturnReason ? (
                    <p className={`${deskRowMutedClass} text-sm text-ink-soft ${deskPreviewClass}`}>
                      {nextReturnReason}
                    </p>
                  ) : null}
                </div>
                {nextReturn.callerPhone ? (
                  <div className={`${deskRowActionClass} shrink-0`}>
                    <WhatsAppLink
                      number={nextReturn.callerPhone}
                      message={followUpWhatsAppMessage({
                        businessName: business,
                        name: nextReturn.callerName,
                        reason: nextReturnReason,
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
              className="relative mt-6 hidden rounded-2xl border border-line bg-surface p-4 lg:block"
            >
              <DeskRowHit
                href={nextReturn.callId ? inboxRecordHref(nextReturn.callId, { purpose: "needs" }) : null}
                label="Conversation"
              />
              <h2
                id="next-return-heading"
                className={`${deskRowMutedClass} text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft`}
              >
                Next to return
              </h2>
              <p className={`${deskRowMutedClass} mt-2 text-sm font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
                {nextReturn.callerName || nextReturn.callerPhone || "Caller"}
                {nextReturnWhen ? (
                  <span className="font-normal text-ink-soft"> · {nextReturnWhen}</span>
                ) : null}
              </p>
              {nextReturnReason ? (
                <p className={`${deskRowMutedClass} mt-0.5 text-sm text-ink-soft ${deskPreviewClass}`}>
                  {nextReturnReason}
                </p>
              ) : null}
              {nextReturn.callerPhone ? (
                <div className={`${deskRowActionClass} mt-3`}>
                  <WhatsAppLink
                    number={nextReturn.callerPhone}
                    message={followUpWhatsAppMessage({
                      businessName: business,
                      name: nextReturn.callerName,
                      reason: nextReturnReason,
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

        <section className="mt-6 min-w-0" aria-labelledby="updates-heading">
          <h2
            id="updates-heading"
            className="flex items-center gap-2 font-display text-xl tracking-tight text-ink"
          >
            <LivePing />
            Updates
          </h2>
          <div className="mt-3">
            <DailyBulletinPanel tenant={tenant} />
          </div>
        </section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-span-5">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <section aria-label="Today" className="px-3 py-3">
              <Link
                href={callsHref({ purpose: "all" })}
                className={[
                  `flex min-h-11 items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-ink-soft ${deskShiftClass} hover:bg-accent/[0.04] hover:text-ink`,
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

            <section aria-label="Line" className="border-t border-line px-4 py-4">
              <p className="text-sm font-medium text-ink">
                {lineStatusLabel(line)}
              </p>
              {line === "live" ? (
                <p className="mt-0.5 truncate font-mono text-xs text-ink-soft">
                  {didDisplay || tenant.sautikit_virtual_number}
                </p>
              ) : null}
            </section>

            <section aria-label="Usage" className="border-t border-line px-4 py-4">
              <p className="font-mono text-sm font-medium text-ink">
                {minutesLeft.toLocaleString("en-KE")} min left
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">{packLabel}</p>
              {minutesExhausted && !isBeta ? (
                <Link
                  href="/wallet"
                  className={`mt-1 inline-flex min-h-11 items-center text-sm font-medium text-warn hover:underline ${focusRingVisible}`}
                >
                  Usage
                </Link>
              ) : null}
            </section>

            {showCta ? (
              <div className="border-t border-line px-4 py-4">
                <Link href={ctaHref} className={`${btnPrimary} w-full`}>
                  {ctaLabel}
                </Link>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
