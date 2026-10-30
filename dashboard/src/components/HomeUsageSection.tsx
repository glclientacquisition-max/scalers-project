import Link from "next/link";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { minutesLeftLabel } from "@/lib/minutes";

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
}: {
  minutesLeft: number;
  minutesUnderOne?: boolean;
  packLabel: string;
  minuteStatus: string | null;
  lowNotice: string | null;
  lowNoticeNote: string | null;
  showLink: boolean;
  isBeta?: boolean;
}) {
  return (
    <section aria-label="Usage" className="min-w-0 overflow-hidden rounded-2xl border border-hairline bg-surface px-4 py-4 lg:col-span-5 lg:col-start-8 lg:row-start-2">
      <p className="text-body font-medium tabular-nums text-ink">
        {minutesLeftLabel({ left: minutesLeft, underOneMinute: minutesUnderOne })}
      </p>
      <p className="mt-0.5 text-meta text-ink-2">{packLabel}</p>
      {minuteStatus ? <p className="mt-0.5 text-meta font-medium text-ink">{minuteStatus}</p> : null}
      {lowNotice ? (
        <p role="status" data-low-notice={isBeta ? "beta" : "warn"} className={`mt-1 text-meta font-medium ${isBeta ? "text-ink-2" : "text-warn"}`}>
          {lowNotice}
        </p>
      ) : null}
      {lowNotice && lowNoticeNote ? <p className="mt-0.5 text-meta text-ink-2">{lowNoticeNote}</p> : null}
      {showLink ? (
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
