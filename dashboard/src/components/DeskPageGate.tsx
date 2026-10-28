import { Suspense, type ReactNode } from "react";
import { DeskPageSkeleton } from "@/components/DeskPageSkeleton";
import { DeskPageCommit } from "@/components/DeskNavState";

/**
 * Page shell for a desk tap. The async body suspends here so Overview, Inbox,
 * and the other destinations paint before their data arrives.
 * Do not replace this with `(desk)/loading.tsx`.
 */
export function DeskPageGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback ?? <DeskPageSkeleton />}>
      <DeskPageCommit>{children}</DeskPageCommit>
    </Suspense>
  );
}
