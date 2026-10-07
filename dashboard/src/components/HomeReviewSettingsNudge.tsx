"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { reviewGapCopy, type CaptureScore } from "@/lib/completenessStub";
import { settingsHrefForGapDomain } from "@/lib/fieldMetaAttestUi";

export function HomeReviewSettingsNudge({
  tenantId,
  vertical,
  score,
  unattestedCount = 0,
}: {
  tenantId: string;
  vertical: string | null | undefined;
  score: CaptureScore;
  unattestedCount?: number;
}) {
  const [dismissed, setDismissed] = useState(false);
  const storageKey = `scalers.captureNudge.${tenantId}`;
  const gap = score.next_gaps[0];
  const href = settingsHrefForGapDomain(gap?.domain);
  const gapLine = reviewGapCopy(gap?.action || "");

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

  const countLine =
    unattestedCount > 0
      ? `${unattestedCount} fact${unattestedCount === 1 ? "" : "s"} still marked suggested`
      : null;

  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-body text-ink">Review settings</p>
        <p className="mt-0.5 text-meta text-ink-2">
          {countLine || gapLine || "Confirm what is on file so the score matches your shop."}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <ButtonLink href={href} variant="tonal" size="sm">
          Open
        </ButtonLink>
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
