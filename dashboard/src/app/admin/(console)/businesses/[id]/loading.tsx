import { Skeleton } from "@/components/ui/Skeleton";

export default function AdminBusinessLoading() {
  return (
    <div className="space-y-4 px-4 pt-4">
      <Skeleton className="h-8 w-2/3 max-w-xs" />
      <Skeleton className="h-4 w-full max-w-sm" />
      <div className="divide-y divide-hairline rounded-xl border border-hairline">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="mx-4 my-4 h-12" />
        ))}
      </div>
    </div>
  );
}
