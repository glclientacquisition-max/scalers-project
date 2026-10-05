import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

export default function AdminPlatformLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-28 rounded-xl" />
      <SkeletonList rows={4} />
      <SkeletonList rows={2} />
    </div>
  );
}
