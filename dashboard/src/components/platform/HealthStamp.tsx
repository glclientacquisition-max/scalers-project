import { Stamp } from "@/components/ui/Stamp";
import { STATE_WORD, absoluteEat, relativeTime, type HealthState } from "@/lib/providerHealthModel";

/** Status word + colour. Down and Degraded share the warn token; the word carries the difference. */
export function HealthStamp({ state }: { state: HealthState }) {
  const tone = state === "ok" ? "ok" : state === "unknown" ? "neutral" : "attention";
  return (
    <Stamp
      tone={tone}
      className={`rounded-full bg-surface-2 px-2.5 py-1 ${state === "down" ? "font-semibold" : ""}`}
    >
      <span className="sr-only">Status: </span>
      {STATE_WORD[state]}
    </Stamp>
  );
}

/** Relative time, absolute EAT on hover. */
export function CheckedTime({ iso, now }: { iso: string | null | undefined; now?: number }) {
  return (
    <time dateTime={iso || undefined} title={absoluteEat(iso)} className="tabular-nums" suppressHydrationWarning>
      {relativeTime(iso, now)}
    </time>
  );
}

/** Large tabular figure with a quiet unit. "Balance unknown" when we can't read one. */
export function BalanceFigure({
  amount,
  unit,
  size = "lg",
}: {
  amount: string | null;
  unit: string | null;
  size?: "lg" | "sm";
}) {
  if (!amount) return <span className="text-meta text-ink-2">Balance unknown</span>;
  // Currency reads before the figure (KES 2,500); counts read after (900 units).
  const currency = unit?.match(/^[A-Z]{3}\b/)?.[0] ?? null;
  const after = (currency ? unit!.slice(3) : unit || "").replace(/^\s+/, "");
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {currency ? <span className="text-meta font-medium text-ink-2">{currency}</span> : null}
      <span className={size === "lg" ? "font-display text-display tabular-nums text-ink" : "text-meta font-medium tabular-nums text-ink"}>
        {amount}
      </span>
      {after ? <span className="text-meta text-ink-2">{after}</span> : null}
    </span>
  );
}
