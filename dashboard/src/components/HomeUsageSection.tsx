import Link from "next/link";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { MinutesMeter } from "@/components/ui/MinutesMeter";
import { StatusMark } from "@/components/ui/StatusMark";
import { minutesLeftLabel } from "@/lib/minutes";
import { minutesMeterMark, type MinutesMeterInput } from "@/lib/minutesMeter";

/**
 * Home aside: minutes left, the plan line, and a warn line only when minutes run low.
 * During beta nothing is charged and calls keep working, so the low line stays calm (no warn colour).
 */
export function HomeUsageSection({
  minutesLeft,
  minutesUnderOne = false,
  packLabel,
  minuteStatus,
  lowNotice,
  lowNoticeNote,
  showLink,
  isBeta = false,
  meter = null,
}: {
  minutesLeft: number;
  minutesUnderOne?: boolean;
  packLabel: string;
  minuteStatus: string | null;
  lowNotice: string | null;
  lowNoticeNote: string | null;
  showLink: boolean;
  isBeta?: boolean;
  meter?: MinutesMeterInput | null;
}) {
  const mark = meter ? minutesMeterMark(meter) : null;
  return (
    <section aria-label="Usage" className="min-w-0 overflow-hidden rounded-2xl border border-hairline bg-surface px-4 py-4 lg:col-span-5 lg:col-start-8 lg:row-start-2">
      {meter ? <MinutesMeter input={meter} shape="ring" showChip={false} /> : null}
      <p className="mt-2 text-body font-medium tabular-nums text-ink">
        {minutesLeftLabel({ left: minutesLeft, underOneMinute: minutesUnderOne })}
      </p>
      {mark ? <StatusMark tone={mark.tone} wrap className="mt-2">{mark.word}</StatusMark> : null}
      <p className="mt-0.5 text-meta text-ink-2">{packLabel}</p>
      {meter ? null : minuteStatus ? <p className="mt-0.5 text-meta font-medium text-ink">{minuteStatus}</p> : null}
      {meter || isBeta ? null : lowNotice ? (
        <p role="status" data-low-notice={isBeta ? "beta" : "warn"} className={`mt-1 text-meta font-medium ${isBeta ? "text-ink-2" : "text-warn"}`}>
          {lowNotice}
        </p>
      ) : null}
      {!meter && !isBeta && lowNotice && lowNoticeNote ? <p className="mt-0.5 text-meta text-ink-2">{lowNoticeNote}</p> : null}
      {!meter && showLink ? (
        <Link
          href="/wallet"
          className={`mt-1 inline-flex min-h-11 items-center text-body font-medium text-accent hover:underline ${focusRingVisible}`}
        >
          Usage
        </Link>
      ) : null}
    </section>
  );
}
