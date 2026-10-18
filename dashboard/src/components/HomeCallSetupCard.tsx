"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { browserCallSetupStore, showFinishCallsCard } from "@/lib/callSetupStore";

/**
 * Overview re-entry to /onboarding/line until the owner presses "I tested it".
 * Picks live in localStorage for now (see callSetupStore), so this decides after mount.
 */
export function HomeCallSetupCard({ tenantId, numberReady }: { tenantId: string; numberReady: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(showFinishCallsCard({ numberReady, setup: browserCallSetupStore().load(tenantId) }));
  }, [tenantId, numberReady]);

  if (!show) return null;

  return (
    <section
      aria-labelledby="finish-calls"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3"
      data-home-call-setup=""
    >
      <div className="min-w-0">
        <h2 id="finish-calls" className="text-body font-semibold text-ink">
          Finish setting up your calls
        </h2>
        <p className="mt-0.5 text-meta text-ink-2">Share your number or forward your line, then test it.</p>
      </div>
      <Link href="/onboarding/line" className={buttonClass({ variant: "tonal", size: "md" })}>
        Set up
      </Link>
    </section>
  );
}
