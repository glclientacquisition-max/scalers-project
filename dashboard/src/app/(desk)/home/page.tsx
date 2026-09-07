import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  nairobiDateLabel,
  nairobiDayStartIso,
  nairobiGreeting,
  walletKes,
} from "@/lib/callsTriage";
import {
  formatBulletinEndLabel,
  liveBulletinItems,
} from "@/lib/dailyBulletin";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { assessMvpAnswerReadiness } from "@/lib/mvpAnswerReadiness";
import { lineStatusLabel, resolveLineStatus } from "@/lib/lineStatus";
import {
  btnGhost,
  btnPrimary,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import {
  homeBriefing,
  homeQueueUnit,
  summarizeInboxWork,
} from "@/lib/inboxPurpose";
import { loadInboxItems } from "@/lib/inboxLoad";
import { nicheCopy } from "@/lib/inboxNiche";

export default async function HomeOverviewPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="font-medium text-[#005CCC]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Not signed in.
      </div>
    );
  }

  const client = workspace.client;
  const dayStart = nairobiDayStartIso();
  const kes = walletKes(tenant);
  const lowWallet = kes < 200;
  const business = tenant.business_name?.trim() || "your workspace";
  const liveUpdates = liveBulletinItems(tenant.daily_bulletin);
  const primaryUpdate = liveUpdates[0] ?? null;
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

  const [todayRes, inbox] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    loadInboxItems(client, tenant.id, vertical),
  ]);

  const todayCount = todayRes.count ?? 0;
  const work = summarizeInboxWork(inbox.items);
  const waitingCount = work.needs;
  const briefing = homeBriefing(
    {
      toReturn: work.toReturn,
      toFulfill: work.toFulfill,
      toConfirm: work.toConfirm,
    },
    vertical
  );
  const holdSample =
    work.nextHold?.headline || work.nextHold?.hold?.when_text || null;
  const jobSample =
    work.nextJob?.job?.when_text || work.nextJob?.headline || null;

  const queues = [
    {
      id: "needs",
      label: "Needs you",
      href: callsHref({ purpose: "human" }),
      count: work.toReturn,
      unit: homeQueueUnit(work.toReturn, copy.returnUnit),
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
  } else if (line === "needs_training") {
    ctaHref = businessSettingsHref("train");
    ctaLabel = "Train";
  }

  const showCta = !(line === "pending" && waitingCount === 0);

  return (
    <div className="w-full min-w-0">
      <header className="min-w-0">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {nairobiGreeting()}
        </p>
        <h1 className="mt-1 font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">
          {business}
        </h1>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">
          <time dateTime={today.iso}>{today.label}</time>
        </p>
      </header>

      {primaryUpdate ? (
        <aside aria-label="Live updates" className="mt-6 w-full min-w-0">
          <div className="relative overflow-hidden rounded-2xl border border-[#0096FF]/25 bg-[color-mix(in_srgb,var(--accent-soft)_70%,white)] px-4 py-3">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-[#0096FF]"
            />
            <div className="flex min-w-0 flex-col gap-3 pl-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[#005CCC]">
                  Updates
                  {liveUpdates.length > 1 ? ` · ${liveUpdates.length} live` : ""}
                </p>
                <p className="mt-1 font-display text-base tracking-tight text-ink [overflow-wrap:anywhere]">
                  {primaryUpdate.text}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {formatBulletinEndLabel(primaryUpdate.ends_at)}
                </p>
              </div>
              <Link href={businessSettingsHref("updates")} className={btnGhost}>
                Manage
              </Link>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8" aria-labelledby="work-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2
              id="work-heading"
              className="font-display text-xl tracking-tight text-ink"
            >
              Work
            </h2>
            <p className="text-[13px] text-ink-soft">{briefing}</p>
          </div>

          <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
            {queues.map((queue, index) => (
              <li
                key={queue.id}
                className={index === 0 ? undefined : "border-t border-line"}
              >
                <Link
                  href={queue.href}
                  className={[
                    "flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium",
                    "transition-colors duration-150",
                    "hover:bg-[#0096FF]/[0.04] active:bg-[#0096FF]/[0.08]",
                    focusRingVisible,
                  ].join(" ")}
                >
                  <span className="text-ink">{queue.label}</span>
                  <span className="flex min-w-0 items-center gap-3 text-ink-soft">
                    <span className="min-w-0 truncate">
                      <span className="tabular-nums font-medium text-ink">
                        {queue.count}
                      </span>{" "}
                      {queue.unit}
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
        </section>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-span-4">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <section aria-label="Today" className="px-3 py-3">
              <Link
                href={callsHref({ purpose: "all" })}
                className={[
                  "flex min-h-11 items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-ink-soft",
                  "transition-colors duration-150 hover:bg-[#0096FF]/[0.04] hover:text-ink",
                  "active:bg-[#0096FF]/[0.08]",
                  focusRingVisible,
                ].join(" ")}
              >
                <span>Calls today</span>
                <span className="tabular-nums font-medium text-ink">{todayCount}</span>
              </Link>
            </section>

            <section
              aria-labelledby="line-heading"
              className="border-t border-line px-4 py-4"
            >
              <h2
                id="line-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
              >
                Line
              </h2>
              <p className="mt-2 text-sm font-medium text-ink">
                {lineStatusLabel(line)}
              </p>
              {line === "live" ? (
                <p className="mt-0.5 truncate font-mono text-xs text-ink-soft">
                  {tenant.sautikit_virtual_number}
                </p>
              ) : null}
              {lowWallet ? (
                <Link
                  href="/wallet"
                  className={`mt-2 block text-sm text-warn ${focusRingVisible}`}
                >
                  Wallet low
                  <span className="block font-mono text-xs font-normal">
                    KES {kes.toLocaleString("en-KE")}
                  </span>
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
