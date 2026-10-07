import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

export default function ContactsLoading() {
  return (
    <div className="space-y-4 bg-canvas" aria-busy="true">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-11 w-16 rounded-xl" />
      </div>
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full max-w-md rounded-xl" />
      <SkeletonList rows={5} withActions />
    </div>
  );
}
