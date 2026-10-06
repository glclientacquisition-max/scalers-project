import { SkeletonList } from "@/components/ui/Skeleton";

export default function AdminPackagesLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <SkeletonList rows={2} />
      <SkeletonList rows={6} />
    </div>
  );
}
