"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import { BaStakesPreview } from "@/components/BaStakesPreview";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import type { StakeLine } from "@/lib/baStakes";
import { reviewGapCopy, type CaptureScore } from "@/lib/completenessStub";

const DOMAINS: Array<{ key: string; label: string; href: string; fallback: string }> = [
  { key: "identity", label: "Identity", href: businessSettingsHref("train", "identity"), fallback: "Confirm the business name" },
  { key: "catalog", label: "Catalog", href: businessSettingsHref("catalog"), fallback: "Add products or services with prices" },
  { key: "hours", label: "Hours", href: businessSettingsHref("train", "hours"), fallback: "Add opening hours" },
  { key: "locations", label: "Location", href: businessSettingsHref("train", "locations"), fallback: "Add a landmark" },
  { key: "payments", label: "Payments", href: businessSettingsHref("train", "policies"), fallback: "Add how customers pay" },
  { key: "policies", label: "Policies", href: businessSettingsHref("train", "policies"), fallback: "Add returns and delivery" },
  { key: "faqs", label: "FAQs", href: businessSettingsHref("train", "faqs"), fallback: "Confirm three answers" },
  { key: "team_notify", label: "Alerts", href: businessSettingsHref("alerts"), fallback: "Set a WhatsApp or email alert" },
  { key: "assistant", label: "Assistant", href: businessSettingsHref("train", "tools"), fallback: "Name the assistant" },
  { key: "bulletin", label: "Bulletin", href: "/home#updates", fallback: "Add today's note" },
];

function ScoreRing({ value }: { value: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="text-accent" aria-hidden="true">
      <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-hairline" />
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
    </svg>
  );
}

export function HomeCapture({
  tenantId,
  vertical,
  score,
  stakes,
}: {
  tenantId: string;
  vertical: string | null | undefined;
  score: CaptureScore;
  stakes: StakeLine[];
}) {
  const [dismissed, setDismissed] = useState(false);
  const nudge = reviewGapCopy(score.next_gaps[0]?.action || "");
  const storageKey = `scalers.captureNudge.${tenantId}`;

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

  return (
    <section className="mt-6" aria-labelledby="setup-heading">
      <div className="flex items-center gap-3">
        <ScoreRing value={score.overall} />
        <div className="min-w-0">
          <h2 id="setup-heading" className="text-title text-ink">
            Setup
          </h2>
          <p className="text-meta tabular-nums text-ink-2">
            {score.overall}%
            {score.ready_badge ? " · Ready" : ""}
          </p>
        </div>
        {score.ready_badge ? <Stamp tone="ok">Ready</Stamp> : null}
      </div>
      <p className="mt-2 text-meta text-ink-2">Enquiries always go through.</p>

      {!score.ready_badge && !dismissed ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-body text-ink">Review and confirm</p>
            <p className="mt-0.5 text-meta text-ink-2">
              {nudge || "Confirm what is already on file."}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {DOMAINS.map((domain) => {
          const pct = Math.round(Number(score.domains[domain.key] ?? 0));
          const gap = reviewGapCopy(
            score.next_gaps.find((item) => item.domain === domain.key)?.action || ""
          );
          return (
            <ListRow
              key={domain.key}
              href={domain.href}
              title={domain.label}
              preview={pct >= 100 ? "Confirmed" : gap || domain.fallback}
              when={<span className="tabular-nums">{pct}%</span>}
            />
          );
        })}
      </ul>

      <BaStakesPreview title="What your BA will say" lines={stakes} />
    </section>
  );
}
