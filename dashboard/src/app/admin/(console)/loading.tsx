import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

export default function AdminConsoleLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-8 w-40 rounded-xl" />
      <SkeletonList rows={6} />
    </div>
  );
}
