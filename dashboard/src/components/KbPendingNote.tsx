import { KB_PENDING_LINE } from "@/lib/kbCaller";

/**
 * Calm status above a caller preview when the latest saves have not reached calls yet (they compile on their own).
 * Polite live region, so a screen reader hears it once without stealing focus. Tokens only.
 */
export function KbPendingNote({ pending, className = "" }: { pending: boolean; className?: string }) {
  return (
    <p role="status" aria-live="polite" data-kb-pending={pending ? "yes" : "no"} className={className}>
      {pending ? (
        <span className="block rounded-2xl border border-hairline bg-surface-2 px-4 py-3 text-meta text-ink-2">{KB_PENDING_LINE}</span>
      ) : null}
    </p>
  );
}
