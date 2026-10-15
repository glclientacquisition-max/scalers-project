import Link from "next/link";
import type { ReactNode } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckedTime, HealthStamp } from "@/components/platform/HealthStamp";
import { ProviderCardView } from "@/components/platform/ProviderCards";
import type { LineRow } from "@/lib/platformHealthData";
import {
  type Banner,
  type CallStats,
  type FixItem,
  type ProviderCard,
} from "@/lib/providerHealthModel";

const linkClass = "text-meta font-medium text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 px-4">
      <h2 className="min-w-0 flex-1 text-caption text-ink-3">{title}</h2>
      {children}
    </div>
  );
}

/** Shared header: Checked time + Refresh link (a plain reload, no state change). */
export function PlatformHeader({ checkedAt }: { checkedAt: string }) {
  return (
    <header className="flex items-baseline gap-3 px-4">
      <h1 className="min-w-0 flex-1 text-title font-medium text-ink">Platform</h1>
      <span className="text-meta text-ink-2">
        Checked <CheckedTime iso={checkedAt} />
      </span>
      <Link href="/admin/platform" prefetch={false} className={linkClass}>
        Refresh
      </Link>
    </header>
  );
}

export function CallsBanner({ banner }: { banner: Banner }) {
  return (
    <section aria-label="Can calls go through" className="rounded-2xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-title font-medium text-ink">{banner.headline}</p>
        <HealthStamp state={banner.state} />
      </div>
      {banner.reason ? (
        <p className="mt-1 text-meta text-ink-2">
          {banner.reason}
          {banner.owner ? <span className="text-ink-3"> · Owner: {banner.owner}</span> : null}
        </p>
      ) : null}
      {banner.pinned ? (
        <p className="mt-2 text-meta text-ink-2">
          Aris line {banner.pinned.e164}:{" "}
          {banner.pinned.business ? `${banner.pinned.business} · ${banner.pinned.status}` : banner.pinned.status || "not in the pool"}
        </p>
      ) : null}
    </section>
  );
}

export function CallStatsStrip({ stats }: { stats: CallStats | null }) {
  const cells: Array<[string, string]> = stats
    ? [
        ["Calls, last hour", String(stats.lastHour)],
        ["Calls, last 24 h", String(stats.lastDay)],
        ["Answered, 24 h", stats.answeredPct != null ? `${stats.answeredPct}%` : "n/a"],
      ]
    : [["Calls", "Could not read the calls table"]];
  return (
    <section aria-label="Calls" className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-surface px-4 py-3">
          <p className="text-meta text-ink-2">{label}</p>
          <p className="text-title font-medium tabular-nums text-ink">{value}</p>
        </div>
      ))}
    </section>
  );
}

export function FixList({ items }: { items: FixItem[] }) {
  return (
    <section aria-label="To fix">
      <SectionHead title="To fix" />
      {items.length ? (
        <ol className="divide-y divide-hairline">
          {items.map((item, i) => (
            <li key={item.key} className="flex items-baseline gap-3 py-3 ps-4 pe-4">
              <span className="w-5 shrink-0 text-meta tabular-nums text-ink-3">{i + 1}</span>
              <span className="min-w-0 flex-1 text-body text-ink">{item.text}</span>
              <span className="shrink-0 text-meta text-ink-2">{item.owner}</span>
              <a href={item.href} target="_blank" rel="noreferrer" className={linkClass}>
                Open
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-3 text-meta text-ink-2">Nothing to fix.</p>
      )}
    </section>
  );
}

export function ProviderColumn({ label, cards, sha }: { label: string; cards: ProviderCard[]; sha: string | null }) {
  const sorted = [...cards].sort((a, b) => Number(a.state === "ok") - Number(b.state === "ok") || Number(b.carriesCalls) - Number(a.carriesCalls));
  return (
    <section aria-label={`${label} providers`} className="min-w-0 space-y-2">
      <SectionHead title={label}>{sha ? <span className="text-caption tabular-nums text-ink-3">Voice {sha.slice(0, 7)}</span> : null}</SectionHead>
      <ul className="space-y-2">
        {sorted.map((c) => (
          <ProviderCardView key={`${c.env}:${c.id}`} card={c} />
        ))}
      </ul>
    </section>
  );
}

export function LinesList({ lines }: { lines: LineRow[] | null }) {
  return (
    <section aria-label="Lines">
      <SectionHead title="Lines">
        <Link href="/admin/numbers" className={linkClass}>
          Numbers
        </Link>
      </SectionHead>
      {!lines ? (
        <p className="px-4 py-3 text-meta text-ink-2">Could not read the number pool.</p>
      ) : lines.length ? (
        <ul className="divide-y divide-hairline">
          {lines.map((l) => (
            <ListRow
              key={l.e164}
              title={`${l.e164}${l.pinned ? " · Aris" : ""}`}
              preview={l.business || "No business"}
              stamp={<span className="text-meta text-ink-2">{l.status}</span>}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-meta text-ink-2">No numbers in the pool.</p>
      )}
    </section>
  );
}

export type HostingRow = { name: string; detail: string; href: string };

export function HostingList({ rows }: { rows: HostingRow[] }) {
  return (
    <section aria-label="Hosting">
      <SectionHead title="Hosting" />
      <ul className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.name} className="flex items-baseline gap-3 py-3 ps-4 pe-4">
            <span className="w-24 shrink-0 text-body font-medium text-ink">{r.name}</span>
            <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{r.detail}</span>
            <a href={r.href} target="_blank" rel="noreferrer" className={linkClass}>
              Console
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-2 rounded-2xl border border-hairline bg-surface px-4 py-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-2/5" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3.5 w-4/5" />
      ))}
    </div>
  );
}
