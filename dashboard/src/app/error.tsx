"use client";

import { DeskCrash } from "@/components/ui/DeskCrash";

export default function RootErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <DeskCrash title="Could not load this page." onRetry={reset} />
    </main>
  );
}
