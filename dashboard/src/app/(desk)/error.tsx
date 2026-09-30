"use client";

import { useLayoutEffect } from "react";
import { useDeskPendingSetter } from "@/components/DeskNavState";
import { DeskCrash } from "@/components/ui/DeskCrash";
import { nextDeskPendingHref } from "@/lib/deskPending";

export default function DeskErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const setPending = useDeskPendingSetter();
  useLayoutEffect(() => {
    setPending((current) => nextDeskPendingHref(current, { type: "error" }));
  }, [setPending]);
  return <DeskCrash title="Could not load this page." onRetry={reset} />;
}
