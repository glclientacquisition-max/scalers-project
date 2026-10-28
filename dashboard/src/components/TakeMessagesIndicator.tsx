import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { cx } from "@/lib/cx";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { TAKE_MESSAGES_COPY, TAKE_MESSAGES_HREF, takeMessagesIndicatorNote, type TakeMessagesState } from "@/lib/takeMessages";

/**
 * Inbox header: a small, persistent "Taking messages only" while brain_mode is safe, linking back to the
 * switch on Identity. Says who turned it on when it was not the owner. Nothing when off.
 */
export function TakeMessagesIndicator({ state }: { state: TakeMessagesState | null | undefined }) {
  if (!state?.on) return null;
  const note = takeMessagesIndicatorNote(state);
  return (
    <Link
      href={TAKE_MESSAGES_HREF}
      data-take-messages-indicator={state.by || "owner"}
      aria-label={`${TAKE_MESSAGES_COPY.indicator}${note ? `. ${note}` : ""}. Open the setting`}
      className={cx(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-accent-soft px-3 text-meta font-medium text-accent-deep",
        "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        deskShiftClass,
      )}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 truncate">
        {TAKE_MESSAGES_COPY.indicator}
        {note ? <span className="font-normal text-ink-2">{` · ${note}`}</span> : null}
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0" />
    </Link>
  );
}
