import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

export default function AdminQualityBusinessLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-48 rounded-md" />
      <Skeleton className="h-7 w-24 rounded-md" />
      <SkeletonList rows={5} />
    </div>
  );
}
