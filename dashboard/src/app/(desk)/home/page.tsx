import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  formatCallWhen,
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
  metaLabelClass,
  pageTitleClass,
  tableCellClass,
  tableHeadCellClass,
} from "@/components/ui/deskChrome";
import type { CallRow } from "@/lib/supabase";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

const HOME_LEAD_LIMIT = 8;

function LineChip({
  status,
}: {
  status: ReturnType<typeof resolveLineStatus>;
}) {
  const tone =
    status === "live"
      ? "bg-ok-soft text-ok"
      : status === "pending"
        ? "bg-accent-soft text-[#005CCC]"
        : "bg-warn-soft text-warn";
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-semibold ${tone}`}
    >
      {lineStatusLabel(status)}
    </span>
  );
}

function StatLink({
  href,
  label,
  value,
  warn = false,
}: {
  href: string;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "flex min-h-11 min-w-0 items-baseline gap-2 rounded-xl border px-3 py-2",
        warn ? "border-warn/45 bg-warn-soft" : "border-line bg-surface",
        "hover:border-[#0096FF]/45",
        focusRingVisible,
      ].join(" ")}
    >
      <span className={metaLabelClass}>{label}</span>
      <span
        className={[
          "font-display text-lg tracking-tight",
          warn ? "text-warn" : "text-ink",
        ].join(" ")}
      >
        {value}
      </span>
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

  const [todayRes, newRes, followedRes, needsRes] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    countEq("new"),
    countEq("contacted"),
    client
      .from("calls")
      .select(CALL_SELECT)
      .eq("tenant_id", tenant.id)
      .eq("lead_status", "new")
      .order("created_at", { ascending: false })
      .limit(HOME_LEAD_LIMIT),
  ]);

  const leadStatusReady = !(
    newRes.error && /lead_status|column/i.test(newRes.error.message)
  );

  const todayCount = todayRes.count ?? 0;
  const newCount = leadStatusReady ? newRes.count ?? 0 : 0;
  const followedCount = leadStatusReady ? followedRes.count ?? 0 : 0;
  const leads = leadStatusReady
    ? ((needsRes.data || []) as CallRow[]).map(toLead)
    : [];

  const greeting = nairobiGreeting();

  let ctaHref = businessSettingsHref("test");
  let ctaLabel = "Test line";
  if (newCount > 0) {
    ctaHref = callsHref({ status: "new" });
    ctaLabel = "Process pending leads";
  } else if (line === "needs_training") {
    ctaHref = businessSettingsHref("train");
    ctaLabel = "Train";
  }

  return (
    <div className="w-full min-w-0">
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <LineChip status={line} />
        <div className="min-w-0">
          <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
            {greeting},{" "}
            <span className="font-medium text-ink">{business}</span>
          </p>
          <h1 className={pageTitleClass}>Overview</h1>
        </div>
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
                <p className={`${metaLabelClass} text-[#005CCC]`}>
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

      <section aria-label="Needs you" className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl tracking-tight text-ink">
            Needs you
          </h2>
          {leadStatusReady ? (
            <Link
              href={callsHref({ status: "new" })}
              className={`text-sm font-medium text-[#005CCC] ${focusRingVisible}`}
            >
              {newCount} new
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
                      "border-t border-line/70 hover:bg-surface-muted/30",
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
                        href={`/calls/${lead.call.id}?from=new`}
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

      <section
        aria-label="What happened"
        className="mt-6 flex flex-wrap gap-2"
      >
        <StatLink
          href={callsHref()}
          label="Today"
          value={String(todayCount)}
        />
        <StatLink
          href={callsHref({ status: "contacted" })}
          label="Followed up"
          value={String(followedCount)}
        />
        <StatLink
          href="/wallet"
          label="Wallet"
          value={`KES ${kes.toLocaleString("en-KE")}`}
          warn={lowWallet}
        />
      </section>

      {line === "pending" && newCount === 0 ? null : (
        <div className="mt-6">
          <Link href={ctaHref} className={`${btnPrimary} w-full sm:w-auto`}>
            {ctaLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
