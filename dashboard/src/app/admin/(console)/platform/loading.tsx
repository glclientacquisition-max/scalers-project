import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

export default function AdminPlatformLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <Skeleton className="h-8 w-36 rounded-xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <SkeletonList rows={3} />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
