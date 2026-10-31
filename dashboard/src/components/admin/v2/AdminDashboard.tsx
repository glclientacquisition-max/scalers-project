import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { HealthStrip } from "@/components/admin/v2/HealthStrip";
import { Sparkline, StatusPill } from "@/components/ops";
import { Segmented } from "@/components/ui/Segmented";
import { getAdminOverview } from "@/lib/admin";
import { listBusinessQuality } from "@/lib/adminQuality";
import { formatScore } from "@/lib/adminQualityModel";
import { loadOverdueForAttention, loadUsageForAttention } from "@/lib/adminAttentionLoad";
import { loadInsightFacts } from "@/lib/adminInsightsLoad";
import { loadInvoicesV2 } from "@/lib/adminInvoicesV2Load";
import { readPlatformOps } from "@/lib/platformOps";
import { buildAttention, attentionCounts, KIND_LABEL, type AttentionKind } from "@/lib/ops/attentionView";
import { billingHomeTotals } from "@/lib/ops/billingHomeView";
import { callsCardModel } from "@/lib/ops/callsCard";
import { ksh } from "@/lib/ops/invoicesView";
import { missedDemand } from "@/lib/ops/insightsView";
import type { OpsSignal } from "@/lib/platformOpsModel";

const MONTH = new Intl.DateTimeFormat("en-KE", { month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
const CLOCK = new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

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
    const kinds = (Object.keys(KIND_LABEL) as AttentionKind[]).filter((k) => counts[k] > 0).slice(0, 3);
    const total = kinds.reduce((sum, k) => sum + counts[k], 0) || 1;
    const owed = overdue ? overdue.reduce((sum, row) => sum + row.owedCents, 0) : null;
    return (
      <Card>
        <h2 className="text-ops-heading text-ink">Needs attention</h2>
        {items.length === 0 ? (
          <p className="mt-2 text-ops-body text-ink-2">{unavailable.length ? "Could not check every reason." : "Nothing needs attention."}</p>
        ) : (
          <>
            <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{items.length}</p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Needs attention by reason">
              {kinds.map((k) => (
                <span key={k} className="h-full bg-warn" style={{ width: `${(counts[k] / total) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-col">
              {kinds.map((k) => (
                <li key={k}>
                  <Link href={`/admin/attention?view=${k}`} className="flex min-h-11 items-center justify-between text-ops-body text-ink">
                    <span>{KIND_LABEL[k]}</span>
                    <span className="tabular-nums text-ink-2">{counts[k]}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {owed != null && owed > 0 ? <p className="text-ops-label tabular-nums text-ink-2">{ksh(owed)} owed</p> : null}
          </>
        )}
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
  const splitTotal = model.split.assistant + model.split.handed + model.split.missed;
  const parts = [
    { key: "assistant", n: model.split.assistant, label: "Assistant", color: "var(--status-ok-fg)" },
    { key: "handed", n: model.split.handed, label: "Handed off", color: "var(--status-info-fg)" },
    { key: "missed", n: model.split.missed, label: "Missed", color: "var(--status-warn-fg)" },
  ].filter((part) => part.n > 0);
  return (
    <Card>
      <Link href={`/admin/quality/insights?days=${days}`} className="block">
        <h2 className="text-ops-heading text-ink">Calls</h2>
        <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{model.calls} <span className="text-ops-body font-normal text-ink-2">reviewed</span></p>
        {model.priorCalls != null ? <p className="text-ops-label tabular-nums text-ink-2">vs prior {days}d · {model.priorCalls}</p> : null}
        {model.weeks.length >= 2 ? <Sparkline points={model.weeks.map((week) => week.calls)} label="Calls by week" /> : null}
        {splitTotal > 0 ? (
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={parts.map((part) => `${part.n} ${part.label}`).join(", ")}>
            {parts.map((part) => (
              <span key={part.key} style={{ width: `${(part.n / splitTotal) * 100}%`, background: part.color }} />
            ))}
          </div>
        ) : null}
      </Link>
    </Card>
  );
}

async function MoneyCard({ now }: { now: Date }) {
  try {
    const loaded = await loadInvoicesV2();
    const totals = billingHomeTotals(loaded.rows, now);
    const quiet = totals.billedThisMonthCents === 0 && totals.outstandingCents === 0;
    return (
      <Card>
        <Link href="/admin/billing/home" className="block">
          <h2 className="text-ops-heading text-ink">Money</h2>
          <p className="text-ops-label text-ink-2">{MONTH.format(now)}</p>
          {quiet ? <p className="mt-2 text-ops-body text-ink-2">Nothing billed this month.</p> : (
            <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{ksh(totals.collectedThisMonthCents)}</p>
          )}
          {totals.overdueCents > 0 ? <StatusPill tone="warn">{ksh(totals.overdueCents)} overdue</StatusPill> : null}
        </Link>
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
    const parts = [
      { key: "live", n: overview.activeBusinesses, href: "/admin/businesses?view=live", label: "Live" },
      { key: "waiting", n: overview.waitingForNumber, href: "/admin/businesses?view=waiting", label: "Waiting" },
      { key: "suspended", n: suspended, href: "/admin/businesses?view=suspended", label: "Suspended" },
    ].filter((part) => part.n > 0);
    const sum = parts.reduce((total, part) => total + part.n, 0) || 1;
    return (
      <Card>
        <h2 className="text-ops-heading text-ink">Businesses</h2>
        <p className="mt-1 tabular-nums text-ops-title font-semibold text-ink">{overview.activeBusinesses} <span className="text-ops-body font-normal text-ink-2">live</span></p>
        {parts.length > 0 ? (
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            {parts.map((part) => (
              <span key={part.key} className="h-full bg-accent" style={{ width: `${(part.n / sum) * 100}%`, opacity: part.key === "live" ? 1 : 0.45 }} />
            ))}
          </div>
        ) : <p className="mt-2 text-ops-body text-ink-2">No businesses yet.</p>}
        <ul className="mt-2">
          {parts.map((part) => (
            <li key={part.key}>
              <Link href={part.href} className="flex min-h-11 items-center justify-between text-ops-body text-ink">
                <span>{part.label}</span>
                <span className="tabular-nums text-ink-2">{part.n}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/admin/numbers?view=available" className="flex min-h-11 items-center justify-between text-ops-body text-ink">
              <span>Free numbers</span>
              <span className="tabular-nums text-ink-2">{overview.availableDids}</span>
            </Link>
          </li>
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
        <p className="mt-1 text-ops-body text-ink">{dropping.length === 0 ? "None dropping" : `${dropping.length} dropping`}</p>
        {worst.length === 0 ? <p className="mt-2 text-ops-body text-ink-2">No scored calls in this range.</p> : (
          <ul className="mt-2 divide-y divide-hairline">
            {worst.map((row) => (
              <li key={row.businessId}>
                <Link href={`/admin/quality?pane=${encodeURIComponent(row.businessId)}&range=${range}`} className="flex min-h-11 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ops-body text-ink">{row.name}</span>
                  <span className="flex items-center gap-2">
                    {row.trend.length >= 2 ? <Sparkline points={row.trend} label={`${row.name} trend`} height={16} width={56} /> : null}
                    <StatusPill tone={row.dropping ? "warn" : "neutral"}>{formatScore(row.score)}</StatusPill>
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
    <div className="ops-theme flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-ops-title text-ink">Overview</h1>
        <Segmented
          label="Range"
          className="w-auto"
          items={[
            { key: "7", label: "7d", href: "/admin?days=7", active: days === 7 },
            { key: "30", label: "30d", href: "/admin?days=30", active: days === 30 },
          ]}
        />
      </div>
      <Suspense fallback={<Skel />}><HealthCard /></Suspense>
      <Suspense fallback={<Skel />}><AttentionCard now={now} /></Suspense>
      <Suspense fallback={<Skel />}><CallsCard days={days} now={now} /></Suspense>
      <div className="grid grid-cols-2 gap-3">
        <Suspense fallback={<Skel />}><MoneyCard now={now} /></Suspense>
        <Suspense fallback={<Skel />}><BusinessesCard /></Suspense>
      </div>
      <Suspense fallback={<Skel />}><QualityCard days={days} /></Suspense>
      <p className="text-ops-label text-ink-3">As of {CLOCK.format(now)}</p>
    </div>
  );
}
