import { SkeletonList } from "@/components/ui/Skeleton";

export default function AdminNumbersLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <SkeletonList rows={3} />
      <SkeletonList rows={6} />
    </div>
  );
}
