"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { saveCallSetupAction } from "@/app/onboarding/line/callSetupActions";
import { browserCallSetupStore, showFinishCallsCard } from "@/lib/callSetupStore";
import { callSetupCardMode, shortDay, worksTitle, type CallSetupCardMode, type CallSetupStatus } from "@/lib/callSetupStatus";

export const CALLS_SETTINGS_HREF = "/settings?tab=calls";

const cardClass =
  "mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-hairline bg-surface px-4 py-3";

/**
 * Overview card for call setup, from tenants.call_setup and the calls table (server).
 * - finish: number ready, not tested (manual or first call after opening the step).
 * - auto: first call arrived after setup; shown until OK.
 * - nudge: tested, then no call for 7 days; Dismiss holds until the next call.
 * Before the column exists (`supported` false) it falls back to browser storage.
 */
export function HomeCallSetupCard({
  tenantId,
  numberReady,
  supported,
  status,
}: {
  tenantId: string;
  numberReady: boolean;
  supported: boolean;
  status: CallSetupStatus | null;
}) {
  const [legacyFinish, setLegacyFinish] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (supported) return;
    setLegacyFinish(showFinishCallsCard({ numberReady, setup: browserCallSetupStore().load(tenantId) }));
  }, [supported, tenantId, numberReady]);

  const mode: CallSetupCardMode = hidden ? null : supported ? callSetupCardMode(status) : legacyFinish ? "finish" : null;
  if (!mode) return null;

  function close(field: "auto_seen_at" | "nudge_dismissed_at") {
    setHidden(true);
    start(async () => {
      await saveCallSetupAction(tenantId, { [field]: new Date().toISOString() });
    });
  }

  if (mode === "finish") {
    return (
      <section aria-labelledby="calls-card" className={cardClass} data-home-call-setup="finish">
        <div className="min-w-0">
          <h2 id="calls-card" className="text-body font-semibold text-ink">
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

  if (mode === "reaching") {
    // A call came in, but not from the test phone: it may have been a direct call.
    return (
      <section aria-labelledby="calls-card" className={cardClass} data-home-call-setup="reaching">
        <div className="min-w-0">
          <h2 id="calls-card" className="text-body font-semibold text-ink">
            Calls are reaching your Business Assistant
          </h2>
          <p className="mt-0.5 text-meta text-ink-2">
            {status?.option === "main_number" ? "To finish setup, run the test call." : "Forwarding isn't tested yet. Run the test call to finish."}
          </p>
        </div>
        <Link href="/onboarding/line" className={buttonClass({ variant: "tonal", size: "md" })}>
          Test
        </Link>
      </section>
    );
  }

  if (mode === "auto") {
    return (
      <section aria-labelledby="calls-card" className={cardClass} data-home-call-setup="auto">
        <div className="min-w-0">
          <h2 id="calls-card" className="text-body font-semibold text-ok">
            {worksTitle(status?.option ?? null)}
          </h2>
          <p className="mt-0.5 text-meta text-ink-2">
            Your test call came in on {shortDay(status?.testedAt ?? null)}. Setup is done.
          </p>
        </div>
        <Button type="button" variant="ghost" size="md" disabled={pending} onClick={() => close("auto_seen_at")}>
          OK
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="calls-card" className={cardClass} data-home-call-setup="nudge">
      <div className="min-w-0">
        <h2 id="calls-card" className="text-body font-semibold text-ink">
          Check your call setup
        </h2>
        <p className="mt-0.5 text-meta text-ink-2">No calls for 7 days. If you forward your line, check it&apos;s still on.</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="md" disabled={pending} onClick={() => close("nudge_dismissed_at")}>
          Dismiss
        </Button>
        <Link href={CALLS_SETTINGS_HREF} className={buttonClass({ variant: "tonal", size: "md" })}>
          Check
        </Link>
      </div>
    </section>
  );
}
