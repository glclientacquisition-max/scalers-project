import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";

/** Route fallback in the shape of the inbox list. No spinner, no extra motion. */
export default function DeskLoading() {
  return (
    <div className="w-full min-w-0" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      <div className="mt-4 flex gap-4 border-b border-line pb-2" aria-hidden="true">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-16" />
      </div>
      <ul className="mt-2 list-none divide-y divide-hairline">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonRow key={i} withActions />
        ))}
      </ul>
    </div>
  );
}
