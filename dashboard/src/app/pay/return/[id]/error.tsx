"use client";

import { Button } from "@/components/ui/Button";

export default function PayReturnError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-surface p-5">
        <p className="text-title text-ink" role="alert">
          Could not load this invoice.
        </p>
        <div className="mt-6">
          <Button type="button" variant="primary" size="lg" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
