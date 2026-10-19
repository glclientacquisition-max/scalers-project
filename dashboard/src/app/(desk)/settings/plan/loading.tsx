import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4" aria-busy="true" aria-label="Loading plan">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="mt-6 h-11 w-48 rounded-xl" />
      <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
      <Skeleton className="mt-3 h-24 w-full rounded-2xl" />
      <Skeleton className="mt-3 h-24 w-full rounded-2xl" />
    </div>
  );
}
