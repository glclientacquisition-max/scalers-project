"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { businessSettingsHref, type SettingsPanel } from "@/lib/businessSettingsNav";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { reviewGapCopy, type CaptureScore } from "@/lib/completenessStub";

function captureSettingsHref(domain: string | undefined): string {
  if (domain === "catalog") return businessSettingsHref("catalog");
  if (domain === "team_notify") return businessSettingsHref("alerts");
  if (domain === "bulletin") return "/home#updates";
  if (domain === "assistant") return businessSettingsHref("train", "tools");
  if (domain === "payments" || domain === "policies") {
    return businessSettingsHref("train", "policies");
  }
  const trainPanels = new Set<string>([
    "identity",
    "hours",
    "locations",
    "faqs",
    "tools",
  ]);
  if (domain && trainPanels.has(domain)) {
    return businessSettingsHref("train", domain as SettingsPanel);
  }
  return businessSettingsHref("train");
}

/** One-line nudge for live lines. Full Setup stays off Overview. */
export function HomeReviewSettingsNudge({
  tenantId,
  vertical,
  score,
}: {
  tenantId: string;
  vertical: string | null | undefined;
  score: CaptureScore;
}) {
  const [dismissed, setDismissed] = useState(false);
  const storageKey = `scalers.captureNudge.${tenantId}`;
  const gap = score.next_gaps[0];
  const href = captureSettingsHref(gap?.domain);
  const preview =
    reviewGapCopy(gap?.action || "") || "Confirm what we have on file.";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      if (vertical !== "home_services") {
        setDismissed(true);
        return;
      }
      const at = Number(raw);
      if (Number.isFinite(at) && Date.now() - at < 7 * 24 * 60 * 60 * 1000) {
        setDismissed(true);
      }
    } catch {
      /* private mode */
    }
  }, [storageKey, vertical]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      /* private mode */
    }
  }

  if (score.ready_badge || dismissed) return null;

  return (
    <section
      className="mt-3 rounded-2xl border border-hairline bg-surface px-4 py-3"
      aria-label="Settings review"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-ink-2">
          {preview}{" "}
          <Link
            href={href}
            className={[
              "font-medium text-accent-deep underline-offset-2 hover:underline",
              deskShiftClass,
              focusRingVisible,
            ].join(" ")}
          >
            Review settings
          </Link>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
