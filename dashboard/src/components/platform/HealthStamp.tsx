import { Stamp } from "@/components/ui/Stamp";
import { STATE_WORD, absoluteEat, relativeTime, type HealthState } from "@/lib/providerHealthModel";

/** Status word + colour. Down and Degraded share the warn token; the word carries the difference. */
export function HealthStamp({ state }: { state: HealthState }) {
  const tone = state === "ok" ? "ok" : state === "unknown" ? "neutral" : "attention";
  return (
    <Stamp tone={tone} className={state === "down" ? "font-semibold" : undefined}>
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
