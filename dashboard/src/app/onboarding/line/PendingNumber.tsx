"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryNumberAction } from "../setupActions";

/** Number pool was empty at finish. Never silent: say so, offer a retry, and confirm the team knows. */
export function PendingNumber({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="pending-label" className="mt-6 rounded-2xl bg-surface p-5">
      <h2 id="pending-label" className="text-title text-ink">
        Your phone number is on its way
      </h2>
      <p className="mt-2 text-body text-ink-2">
        All our numbers are in use right now. We&apos;ve told our team, and your number will show here and on Overview as
        soon as it&apos;s assigned. Your receptionist is ready and starts answering the moment it is.
      </p>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-meta text-ink-2">
        {note}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retryNumberAction(tenantId);
            if (res.ok) {
              setNote("Your number is ready.");
              router.refresh();
            } else {
              setNote(res.error);
            }
          })
        }
        className="mt-2 min-h-11 rounded-xl bg-surface-2 px-4 text-body font-medium text-accent-deep disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {pending ? "Checking…" : "Check again"}
      </button>
    </section>
  );
}
