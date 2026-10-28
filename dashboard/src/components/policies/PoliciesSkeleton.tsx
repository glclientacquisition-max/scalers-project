import { Skeleton } from "@/components/ui/Skeleton";
import { settingsConsoleClass, settingsPanelClass, settingsRailWrapClass } from "@/components/settingsUi";

function CardShape({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-11 items-center px-1">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <Skeleton className="h-5 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Policies loading: the page's own shape (rail, cards, Callers hear), so nothing jumps when it lands. */
export function PoliciesSkeleton() {
  return (
    <div className={settingsConsoleClass} aria-busy="true" aria-label="Loading policies" data-policies-skeleton="">
      <div className={settingsRailWrapClass} aria-hidden="true">
        <div className="space-y-2 pt-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <div className={`${settingsPanelClass} space-y-4`}>
        <div className="flex min-h-11 items-center md:pt-4">
          <Skeleton className="h-7 w-40" />
        </div>
        <div className="grid w-full min-w-0 max-w-desk grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 space-y-6">
            <CardShape rows={2} />
            <CardShape rows={1} />
            <CardShape rows={1} />
            <CardShape rows={4} />
          </div>
          <div className="space-y-1.5">
            <div className="flex min-h-11 items-center px-1">
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="space-y-3 rounded-2xl border border-hairline bg-surface px-4 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-11 w-28 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
