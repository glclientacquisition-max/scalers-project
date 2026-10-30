import Link from "next/link";
import { StatusMark } from "@/components/ui/StatusMark";
import { callsHref } from "@/lib/callsTriage";
import { focusRingVisible } from "@/components/ui/deskChrome";
import type { OutcomeSplit } from "@/lib/todayOutcomes";
import { splitTotal } from "@/lib/todayOutcomes";

export type TodayCallRow = {
  id: string;
  time: string;
  word: string;
  tone: "ok" | "info" | "warn" | "neutral";
  who: string;
  told: boolean;
  href: string | null;
};

const TIME = new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

export function nairobiClock(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? TIME.format(t) : "";
}

/** Outcome split plus up to five of today's calls. Hidden pieces stay hidden. */
export function TodayCalls({
  lineLive,
  split,
  rows,
  truncated,
}: {
  lineLive: boolean;
  /** Null when the facts read failed. */
  split: OutcomeSplit | null;
  rows: TodayCallRow[];
  truncated: boolean;
}) {
  const total = split ? splitTotal(split) : 0;
  const showSplit = lineLive && split != null && total > 0;
  return (
    <section aria-label="Calls today" className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-title text-ink">Calls today</h2>
        {rows.length > 0 ? (
          <Link href={callsHref({ purpose: "all" })} className={`text-body font-medium text-accent ${focusRingVisible}`}>
            See all
          </Link>
        ) : null}
      </div>
      {split == null ? (
        <p role="alert" className="mt-2 text-body text-attention">Could not load outcomes for today.</p>
      ) : null}
      {showSplit && split ? <SplitBar split={split} total={total} /> : null}
      {rows.length === 0 && lineLive && split != null ? (
        <p className="mt-3 text-body text-ink-2">No calls yet today.</p>
      ) : null}
      {truncated ? <p className="mt-2 text-meta text-ink-2">The list is cut off, so this is not every call.</p> : null}
      {rows.length > 0 ? (
        <ul className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="border-t border-hairline first:border-t-0">
              {row.href ? (
                <Link href={row.href} className={`flex min-h-12 items-center gap-2 px-4 py-2 ${focusRingVisible}`}>
                  <RowBody row={row} />
                </Link>
              ) : (
                <div className="flex min-h-12 items-center gap-2 px-4 py-2">
                  <RowBody row={row} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RowBody({ row }: { row: TodayCallRow }) {
  return (
    <>
      <span className="w-12 shrink-0 tabular-nums text-meta text-ink-2">{row.time}</span>
      <StatusMark tone={row.tone}>{row.word}</StatusMark>
      <span className="min-w-0 flex-1 truncate text-body text-ink">{row.who}</span>
      {row.told ? <StatusMark tone="ok">Owner told</StatusMark> : null}
    </>
  );
}

function SplitBar({ split, total }: { split: OutcomeSplit; total: number }) {
  const parts = [
    { key: "answered", n: split.answered, label: "Answered", color: "var(--status-ok-fg)" },
    { key: "handed", n: split.handed, label: "Handed off", color: "var(--status-info-fg)" },
    { key: "hung", n: split.hung, label: "Hung up", color: "var(--status-warn-fg)" },
    { key: "other", n: split.other, label: "Other", color: "var(--status-neutral-fg)" },
  ].filter((p) => p.n > 0);
  return (
    <div className="mt-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}>
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <p className="mt-1 text-meta tabular-nums text-ink-2">
        {parts.map((p) => `${p.label} ${p.n}`).join(" · ")}
      </p>
    </div>
  );
}
