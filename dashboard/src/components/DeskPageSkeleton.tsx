import { SkeletonHeader, SkeletonList } from "@/components/ui/Skeleton";

/** Page slot while Overview, Inbox, or another desk route is still loading. */
export function DeskPageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <SkeletonHeader />
      <SkeletonList rows={6} />
    </div>
  );
}
