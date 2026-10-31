import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { HealthStrip } from "@/components/admin/v2/HealthStrip";
import { MetricSparkline } from "@/components/admin/v2/MetricSparkline";
import { StatusPill } from "@/components/ops";
import { StatusMark } from "@/components/ui/StatusMark";
import { Segmented } from "@/components/ui/Segmented";
import { getAdminOverview } from "@/lib/admin";
import { listBusinessQuality } from "@/lib/adminQuality";
import { formatScore } from "@/lib/adminQualityModel";
import { loadOverdueForAttention, loadUsageForAttention } from "@/lib/adminAttentionLoad";
import { loadInsightFacts } from "@/lib/adminInsightsLoad";
import { loadInvoicesV2 } from "@/lib/adminInvoicesV2Load";
import { readPlatformOps } from "@/lib/platformOps";
import { buildAttention, attentionCounts, KIND_LABEL, type AttentionKind } from "@/lib/ops/attentionView";
import { billingHomeTotals, lastMonthCollected } from "@/lib/ops/billingHomeView";
import { callsCardModel } from "@/lib/ops/callsCard";
import { ksh } from "@/lib/ops/invoicesView";
import { missedDemand } from "@/lib/ops/insightsView";
import type { OpsSignal } from "@/lib/platformOpsModel";

const MONTH = new Intl.DateTimeFormat("en-KE", { month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
const CLOCK = new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
function callsDelta(current: number, prior: number | null, days: number): string | null {
  if (prior == null) return null;
  const d = current - prior;
  const signed = d > 0 ? `+${d}` : String(d);
  return `${signed} vs prior ${days}d`;
}

function Skel() {
  return <div className="h-24 animate-pulse rounded-lg border border-hairline bg-surface" aria-hidden="true" />;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-hairline bg-surface p-3 motion-enter ${className}`}>{children}</section>;
}

function Retry({ href }: { href: string }) {
  return <Link href={href} className="inline-flex min-h-11 items-center text-ops-body font-medium text-accent">Retry</Link>;
}

async function HealthCard() {
  let signals: OpsSignal[] | null = null;
  try {
    signals = (await readPlatformOps()).signals;
  } catch {
    signals = null;
  }
  return <HealthStrip signals={signals} />;
}

async function AttentionCard({ now }: { now: Date }) {
  try {
    const [overview, overdue, usage, facts, quality] = await Promise.all([
      getAdminOverview(),
      loadOverdueForAttention(),
      loadUsageForAttention(),
      loadInsightFacts(7),
      listBusinessQuality("7d").catch(() => null),
    ]);
    const unavailable: AttentionKind[] = [];
    if (!overdue) unavailable.push("overdue");
    if (!usage) unavailable.push("near-limit");
    if (!facts) unavailable.push("missed-demand");
    if (!quality) unavailable.push("quality");
    const businesses = overview.businesses.map((b) => ({
      id: b.id,
      name: b.business_name,
      status: b.status,
      createdAt: b.created_at,
    }));
    const items = buildAttention({
      businesses,
      overdue: overdue || [],
      usage: (usage || []).map((u) => ({ ...u, packageName: overview.businesses.find((b) => b.id === u.tenantId)?.package_name ?? null })),
      quality: (quality || []).filter((q) => q.dropping).map((q) => ({ tenantId: q.businessId, score: q.score, reason: q.droppingReason })),
      missed: missedDemand(facts || [], now),
      now,
    });
    const counts = attentionCounts(items);
    const kinds = (Object.keys(KIND_LABEL) as AttentionKind[])
      .filter((k) => counts[k] > 0)
      .toSorted((a, b) => counts[b] - counts[a] || KIND_LABEL[a].localeCompare(KIND_LABEL[b]));
    const owed = overdue ? overdue.reduce((sum, row) => sum + row.owedCents, 0) : null;
    return (
      <Card>
        <h2 className="text-ops-heading text-ink">Needs attention</h2>
        <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{items.length}</p>
        {items.length === 0 ? (
          <p className="mt-2 text-ops-body text-ink-2">{unavailable.length ? "Could not check every reason." : "Nothing needs attention."}</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {kinds.map((k) => (
              <li key={k}>
                <Link href={`/admin/attention?view=${k}`} className="flex min-h-11 items-center justify-between gap-2 text-ops-body text-ink">
                  <span className="min-w-0 truncate">{KIND_LABEL[k]}</span>
                  <span className="flex shrink-0 items-center gap-1 tabular-nums text-ink-2">
                    {counts[k]}
                    <ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {owed != null && owed > 0 ? <p className="text-ops-label tabular-nums text-ink-2">{ksh(owed)} owed</p> : null}
        {unavailable.length ? <p className="mt-1 text-ops-label text-ink-2">Could not check {unavailable.join(", ")}.</p> : null}
      </Card>
    );
  } catch {
    return <Card><p role="alert" className="text-ops-body text-attention">Could not load what needs attention.</p><Retry href="/admin" /></Card>;
  }
}

async function CallsCard({ days, now }: { days: 7 | 30; now: Date }) {
  const facts = await loadInsightFacts(days * 2);
  const model = callsCardModel(facts, days, now.getTime());
  if (model.state === "error") {
    return <Card><h2 className="text-ops-heading text-ink">Calls</h2><p role="alert" className="mt-2 text-ops-body text-attention">Could not load calls.</p><Retry href={`/admin?days=${days}`} /></Card>;
  }
  if (model.state === "empty") {
    return <Card><h2 className="text-ops-heading text-ink">Calls</h2><p className="mt-2 text-ops-body text-ink-2">No reviewed calls in this range.</p></Card>;
  }
  const legend = [
    { key: "resolved", n: model.split.assistant, word: "resolved", dot: "bg-accent" },
    { key: "handed", n: model.split.handed, word: "handed over", dot: "bg-ink-3" },
    { key: "dropped", n: model.split.missed, word: "dropped", dot: "bg-warn" },
  ];
  const delta = callsDelta(model.calls, model.priorCalls, days);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ops-heading text-ink">Calls</h2>
        <Link href={`/admin/quality/insights?days=${days}`} className="text-ops-body font-medium text-accent">Insights</Link>
      </div>
      <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{model.calls}</p>
      {delta ? <p className="text-meta tabular-nums text-ink-2">{delta}</p> : null}
      <MetricSparkline points={model.series} unit="calls" />
      <ul className="mt-2 flex flex-col gap-1" aria-label="Call outcomes">
        {legend.map((row) => (
          <li key={row.key} className="flex min-h-8 items-center gap-2 text-ops-body text-ink">
            <span className={`h-2 w-2 shrink-0 rounded-full ${row.dot}`} aria-hidden="true" />
            <span className="tabular-nums">{row.n.toLocaleString("en-KE")}</span>
            <span>{row.word}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function MoneyCard({ now }: { now: Date }) {
  try {
    const loaded = await loadInvoicesV2();
    const totals = billingHomeTotals(loaded.rows, now);
    const prior = lastMonthCollected(loaded.rows, now);
    const quiet = totals.billedThisMonthCents === 0 && totals.outstandingCents === 0 && totals.collectedThisMonthCents === 0;
    const moneyDelta = !prior
      ? null
      : totals.collectedThisMonthCents === prior.cents
        ? `Same as ${prior.label}`
        : `${ksh(Math.abs(totals.collectedThisMonthCents - prior.cents))} ${totals.collectedThisMonthCents > prior.cents ? "more" : "less"} than ${prior.label}`;
    const moneySeries = prior
      ? [
          { label: prior.label, value: prior.cents },
          { label: MONTH.format(now), value: totals.collectedThisMonthCents },
        ]
      : [];
    return (
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-ops-heading text-ink">Money</h2>
          <Link href="/admin/billing/home" className="text-ops-body font-medium text-accent">Billing</Link>
        </div>
        <p className="text-ops-label text-ink-2">{MONTH.format(now)}</p>
        {quiet ? <p className="mt-2 text-ops-body text-ink-2">Nothing billed this month.</p> : (
          <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{ksh(totals.collectedThisMonthCents)}</p>
        )}
        {moneyDelta ? <p className="text-meta tabular-nums text-ink-2">{moneyDelta}</p> : null}
        {prior ? <MetricSparkline points={moneySeries} unit="ksh" /> : null}
        {totals.overdueCents > 0 ? <StatusPill tone="warn">{ksh(totals.overdueCents)} overdue</StatusPill> : null}
      </Card>
    );
  } catch {
    return <Card><h2 className="text-ops-heading text-ink">Money</h2><p role="alert" className="text-ops-body text-attention">Could not load billing.</p><Retry href="/admin" /></Card>;
  }
}

async function BusinessesCard() {
  try {
    const overview = await getAdminOverview();
    const suspended = overview.businesses.filter((b) => b.status === "suspended").length;
    const pills = [
      { key: "live", n: overview.activeBusinesses, href: "/admin/businesses?view=live", word: "Live", tone: "ok" as const },
      { key: "waiting", n: overview.waitingForNumber, href: "/admin/businesses?view=waiting", word: "Waiting", tone: "warn" as const },
      { key: "suspended", n: suspended, href: "/admin/businesses?view=suspended", word: "Suspended", tone: "warn" as const },
      { key: "free", n: overview.availableDids, href: "/admin/numbers?view=available", word: "Free", tone: "neutral" as const },
    ];
    return (
      <Card>
        <h2 className="text-ops-heading text-ink">Businesses</h2>
        <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{overview.activeBusinesses}</p>
        <ul className="mt-2 flex flex-col">
          {pills.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className="flex min-h-11 items-center justify-between gap-2">
                <StatusMark tone={row.tone}>{row.word}</StatusMark>
                <span className="flex items-center gap-1 tabular-nums text-ops-body text-ink">
                  {row.n.toLocaleString("en-KE")}
                  <ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    );
  } catch {
    return <Card><h2 className="text-ops-heading text-ink">Businesses</h2><p role="alert" className="text-ops-body text-attention">Could not load businesses.</p><Retry href="/admin" /></Card>;
  }
}

async function QualityCard({ days }: { days: 7 | 30 }) {
  const range = days === 7 ? "7d" : "30d";
  try {
    const rows = await listBusinessQuality(range);
    const dropping = rows.filter((row) => row.dropping);
    const worst = rows.slice(0, 3);
    return (
      <Card>
        <h2 className="text-ops-heading text-ink">Quality</h2>
        <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{dropping.length}</p>
        <p className="text-meta text-ink-2">{dropping.length === 0 ? "None dropping" : "dropping"}</p>
        {worst.length === 0 ? <p className="mt-2 text-ops-body text-ink-2">No scored calls in this range.</p> : (
          <ul className="mt-2 divide-y divide-hairline">
            {worst.map((row) => (
              <li key={row.businessId} className="flex min-h-11 items-center gap-2">
                <Link href={`/admin/quality?pane=${encodeURIComponent(row.businessId)}&range=${range}`} className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ops-body text-ink">{row.name}</span>
                  <span className="flex items-center gap-1">
                    <StatusPill tone={row.dropping ? "warn" : "neutral"}>{formatScore(row.score)}</StatusPill>
                    <ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  } catch {
    return <Card><h2 className="text-ops-heading text-ink">Quality</h2><p role="alert" className="text-ops-body text-attention">Could not load quality.</p><Retry href={`/admin?days=${days}`} /></Card>;
  }
}

/** Admin home: health plus five cards. Money stays on the billing month. */
export function AdminDashboard({ days, now }: { days: 7 | 30; now: Date }) {
  return (
    <div className="ops-theme flex w-full flex-col gap-3 lg:grid lg:grid-cols-12 lg:items-start lg:gap-4">
      <div className="flex w-full items-end justify-between gap-3 border-b border-hairline lg:col-span-12">
        <h1 className="min-w-0 pb-2 text-ops-title text-ink">Overview</h1>
        <Segmented
          flush
          label="Range"
          items={[
            { key: "7", label: "7d", href: "/admin?days=7", active: days === 7 },
            { key: "30", label: "30d", href: "/admin?days=30", active: days === 30 },
          ]}
        />
      </div>
      <div className="lg:col-span-12">
        <Suspense fallback={<Skel />}><HealthCard /></Suspense>
      </div>
      <div className="flex flex-col gap-3 lg:col-span-8">
        <Suspense fallback={<Skel />}><AttentionCard now={now} /></Suspense>
        <Suspense fallback={<Skel />}><CallsCard days={days} now={now} /></Suspense>
      </div>
      <div className="flex flex-col gap-3 lg:col-span-4">
        <Suspense fallback={<Skel />}><BusinessesCard /></Suspense>
        <Suspense fallback={<Skel />}><MoneyCard now={now} /></Suspense>
        <Suspense fallback={<Skel />}><QualityCard days={days} /></Suspense>
      </div>
      <p className="text-ops-label text-ink-3 lg:col-span-12">As of {CLOCK.format(now)}</p>
    </div>
  );
}
