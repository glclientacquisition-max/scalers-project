"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ops";
import { Sheet } from "@/components/ui/Sheet";
import type { OpsSignal } from "@/lib/platformOpsModel";

function toneOf(signal: OpsSignal): "ok" | "warn" | "danger" {
  if (signal.critical) return "danger";
  if (signal.active) return "warn";
  return "ok";
}

function wordOf(signal: OpsSignal): string {
  if (signal.critical) return "Down";
  if (signal.active) return "Needs you";
  return "Clear";
}

/** Six platform signals. Tap opens the detail. No signal is invented. */
export function HealthStrip({ signals }: { signals: OpsSignal[] | null }) {
  const [open, setOpen] = useState<OpsSignal | null>(null);
  if (!signals) {
    return (
      <p role="alert" className="rounded-lg bg-attention-tonal px-ops-3 py-ops-3 text-ops-body text-attention">
        Could not check platform health.
      </p>
    );
  }
  if (signals.length === 0) {
    return <p className="text-ops-body text-ink-2">Nothing was reported.</p>;
  }
  return (
    <section aria-label="Platform health" className="rounded-lg border border-hairline bg-surface p-ops-3">
      <ul className="flex flex-wrap gap-1">
        {signals.map((signal) => (
          <li key={signal.kind}>
            <button
              type="button"
              onClick={() => setOpen(signal)}
              className="inline-flex min-h-11 items-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <StatusPill tone={toneOf(signal)}>{signal.title}</StatusPill>
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={open != null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        title={open?.title || "Platform"}
        theme="admin"
      >
        {open ? (
          <div className="flex flex-col items-start gap-2 px-5 pb-6 sm:px-6">
            <StatusPill tone={toneOf(open)}>{wordOf(open)}</StatusPill>
            <p className="text-body text-ink">{open.detail}</p>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
