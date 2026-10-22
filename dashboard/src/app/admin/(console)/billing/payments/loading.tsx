import { SkeletonList } from "@/components/ui/Skeleton";

export default function AdminPaymentsLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <SkeletonList rows={4} />
      <SkeletonList rows={3} />
    </div>
  );
}
