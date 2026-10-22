import { Skeleton } from "@/components/ui/Skeleton";

/** Same card the pay page uses, before the return id is read. */
export default function Loading() {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-surface p-5" aria-hidden="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-3 w-28" />
        <Skeleton className="mt-6 h-10 w-48" />
        <Skeleton className="mt-3 h-4 w-24" />
        <Skeleton className="mt-2 h-4 w-32" />
        <Skeleton className="mt-8 h-13 w-full rounded-xl" />
      </div>
    </main>
  );
}
