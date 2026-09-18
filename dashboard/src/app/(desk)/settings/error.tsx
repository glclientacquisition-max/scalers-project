"use client";

import { DeskCrash } from "@/components/ui/DeskCrash";

export default function SettingsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DeskCrash title="Could not load Business Profile." onRetry={reset} />;
}
