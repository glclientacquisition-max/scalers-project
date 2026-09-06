import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  formatCallWhen,
  nairobiDateLabel,
  nairobiDayStartIso,
  nairobiGreeting,
  toLead,
  walletKes,
} from "@/lib/callsTriage";
import {
  formatBulletinEndLabel,
  liveBulletinItems,
} from "@/lib/dailyBulletin";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { assessMvpAnswerReadiness } from "@/lib/mvpAnswerReadiness";
import { lineStatusLabel, resolveLineStatus } from "@/lib/lineStatus";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import {
  btnGhost,
  btnPrimary,
  focusRingVisible,
  tableCellClass,
  tableHeadCellClass,
} from "@/components/ui/deskChrome";
import type { CallRow } from "@/lib/supabase";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

const HOME_LEAD_LIMIT = 8;

function StatLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "flex min-h-11 items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-ink-soft",
        "transition-colors duration-150 hover:bg-[#0096FF]/[0.04] hover:text-ink",
        "active:bg-[#0096FF]/[0.08]",
        focusRingVisible,
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="tabular-nums font-medium text-ink">{value}</span>
    </Link>
  );
}

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
  const missingRequired = readiness.items.filter((item) => item.required && !item.ok);

  const countEq = (status: string) =>
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("lead_status", status);

  const [todayRes, newRes, needsRes, openHoldsRes, pendingJobsRes] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    countEq("new"),
    client
      .from("calls")
      .select(CALL_SELECT)
      .eq("tenant_id", tenant.id)
      .eq("lead_status", "new")
      .order("created_at", { ascending: false })
      .limit(HOME_LEAD_LIMIT),
    client
      .from("service_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "open"),
    client
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .in("status", ["requested", "confirmed"]),
  ]);

  const leadStatusReady = !(
    newRes.error && /lead_status|column/i.test(newRes.error.message)
  );

  const todayCount = todayRes.count ?? 0;
  const newCount = leadStatusReady ? newRes.count ?? 0 : 0;
  const openHolds = openHoldsRes.error ? 0 : openHoldsRes.count ?? 0;
  const pendingJobs = pendingJobsRes.error ? 0 : pendingJobsRes.count ?? 0;
  const waitingCount = newCount + openHolds + pendingJobs;
  const leads = leadStatusReady
    ? ((needsRes.data || []) as CallRow[]).map(toLead)
    : [];

  let ctaHref = businessSettingsHref("test");
  let ctaLabel = "Test line";
  if (waitingCount > 0) {
    ctaHref = callsHref({ purpose: "needs" });
    ctaLabel = "Open inbox";
  } else if (line === "needs_training") {
    ctaHref = businessSettingsHref("train");
    ctaLabel = "Train";
  }

  const showCta = !(line === "pending" && newCount === 0);

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
              <Link
                href={businessSettingsHref("updates")}
                className={btnGhost}
              >
                Manage
              </Link>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8" aria-label="Needs you">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-xl tracking-tight text-ink">
              Needs you
            </h2>
            {leadStatusReady ? (
              <Link
                href={callsHref({ purpose: "needs" })}
                className={`text-sm font-medium text-[#005CCC] ${focusRingVisible}`}
              >
                Inbox
              </Link>
            ) : null}
          </div>

          {!leadStatusReady ? (
            <p className="mt-3 text-sm text-ink-soft">
              Lead statuses need{" "}
              <code className="text-xs">docs/supabase/lead_status.sql</code>.
            </p>
          ) : leads.length === 0 ? (
            <div className="mt-3 border-y border-line py-8">
              <p className="font-display text-xl tracking-tight text-ink">
                {line === "needs_training"
                  ? "Train the line"
                  : line === "pending"
                    ? "Number pending"
                    : "Caught up"}
              </p>
              {missingRequired.length > 0 ? (
                <p className="mt-2 text-sm text-ink-soft">
                  {missingRequired
                    .slice(0, 3)
                    .map((item) => item.label)
                    .join(". ")}
                  .
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3">
              <DeskDataTable minWidthClass="min-w-[640px]">
                <thead className="border-b border-line bg-surface-muted/70 text-ink-soft">
                  <tr>
                    <th className={tableHeadCellClass}>When</th>
                    <th className={tableHeadCellClass}>Caller</th>
                    <th className={tableHeadCellClass}>Lead</th>
                    <th className={tableHeadCellClass} />
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.call.id}
                      className={[
                        "border-t border-line/70 border-l-2 border-l-transparent",
                        "transition-colors duration-150",
                        "hover:border-l-[#0096FF] hover:bg-[#0096FF]/[0.04]",
                        "focus-within:border-l-[#0096FF] focus-within:bg-[#0096FF]/[0.04]",
                        "active:bg-[#0096FF]/[0.08]",
                        lead.urgent ? "bg-warn-soft/60" : "",
                      ].join(" ")}
                    >
                      <td className={`${tableCellClass} whitespace-nowrap text-ink-soft`}>
                        {formatCallWhen(lead.call.created_at)}
                      </td>
                      <td className={tableCellClass}>
                        <WhatsAppLink number={lead.call.caller_number} />
                      </td>
                      <td className={tableCellClass}>
                        <div className="font-medium text-ink">
                          {lead.name || "Unknown"}
                          {lead.urgent ? (
                            <span className="ml-2 text-xs font-medium text-warn">
                              urgent
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-ink-soft">
                          {lead.reason || "No reason yet"}
                        </div>
                      </td>
                      <td className={`${tableCellClass} text-right`}>
                        <Link
                          href={`/calls/${lead.call.id}?from=needs`}
                          className={`font-medium text-[#005CCC] ${focusRingVisible}`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DeskDataTable>
            </div>
          )}
        </section>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-span-4">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <section aria-label="What happened" className="px-3 py-3">
              <ul>
                <li>
                  <StatLink
                    href={callsHref({ purpose: "all" })}
                    label="Today"
                    value={String(todayCount)}
                  />
                </li>
                <li>
                  <StatLink
                    href={callsHref({ purpose: "hold" })}
                    label="Holds"
                    value={String(openHolds)}
                  />
                </li>
                <li>
                  <StatLink
                    href={callsHref({ purpose: "job" })}
                    label="Jobs"
                    value={String(pendingJobs)}
                  />
                </li>
              </ul>
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
