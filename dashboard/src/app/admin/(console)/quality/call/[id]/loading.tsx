import { Skeleton } from "@/components/ui/Skeleton";

export default function AdminQualityCallLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-48 rounded-md" />
      <Skeleton className="h-7 w-16 rounded-md" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
