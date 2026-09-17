"use client";

import { DeskCrash } from "@/components/ui/DeskCrash";

export default function DeskErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DeskCrash title="Could not load this page." onRetry={reset} />;
}
