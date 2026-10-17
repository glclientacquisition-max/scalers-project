import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

export default function AdminQualityLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="mx-4 h-11 rounded-xl" />
      <Skeleton className="h-11 w-48 rounded-xl" />
      <SkeletonList rows={6} />
    </div>
  );
}
