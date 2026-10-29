"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { deskErrorClass } from "@/components/ui/deskChrome";

/** Overview: insights query failed. Retry refetches the Suspense slot. */
export function HomeInsightsError() {
  const router = useRouter();
  return (
    <section aria-labelledby="insights-error-title" className="min-w-0 rounded-2xl border border-hairline bg-surface px-4 py-3">
      <h2 id="insights-error-title" className="text-meta font-medium text-ink-2">
        What callers told us
      </h2>
      <p className={`mt-2 ${deskErrorClass}`} role="alert">
        Could not load insights.
      </p>
      <Button type="button" variant="tonal" size="sm" className="mt-3" onClick={() => router.refresh()}>
        Retry
      </Button>
    </section>
  );
}
