import Link from "next/link";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { minutesLeftLabel } from "@/lib/minutes";

/** Home aside: minutes left, the plan line, and a warn line only when minutes run low. */
export function HomeUsageSection({
  minutesLeft,
  minutesUnderOne = false,
  packLabel,
  minuteStatus,
  lowNotice,
  lowNoticeNote,
  showLink,
}: {
  minutesLeft: number;
  minutesUnderOne?: boolean;
  packLabel: string;
  minuteStatus: string | null;
  lowNotice: string | null;
  lowNoticeNote: string | null;
  showLink: boolean;
}) {
  return (
    <section aria-label="Usage" className="border-t border-hairline px-4 py-4">
      <p className="text-body font-medium tabular-nums text-ink">
        {minutesLeftLabel({ left: minutesLeft, underOneMinute: minutesUnderOne })}
      </p>
      <p className="mt-0.5 text-meta text-ink-2">{packLabel}</p>
      {minuteStatus ? <p className="mt-0.5 text-meta font-medium text-ink">{minuteStatus}</p> : null}
      {lowNotice ? (
        <p role="status" className="mt-1 text-meta font-medium text-warn">
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
