import { ButtonLink } from "@/components/ui/Button";
import type { PlanEntry } from "@/lib/planEntry";

/** Team, when every seat is taken. Alert contacts never use a seat. */
export function TeamSeatsNote({ included, entry }: { included: number; entry: PlanEntry | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3">
      <div className="min-w-0">
        <p role="status" className="text-body font-medium text-warn">
          All {included} {included === 1 ? "seat is" : "seats are"} in use
        </p>
        <p className="mt-0.5 text-meta text-ink-2">Alert contacts get notified and do not need a seat.</p>
      </div>
      {entry ? (
        <ButtonLink href={entry.href} variant="tonal" size="sm">
          {entry.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}
