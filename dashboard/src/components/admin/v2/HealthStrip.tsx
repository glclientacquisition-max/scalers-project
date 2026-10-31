"use client";

import { useState } from "react";
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

const DOT = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-attention",
} as const;

/** One line of exception dots. All clear when nothing is active. At most 4, then More. */
export function HealthStrip({ signals }: { signals: OpsSignal[] | null }) {
  const [open, setOpen] = useState<OpsSignal | null>(null);
  const [more, setMore] = useState(false);
  if (!signals) {
    return (
      <p role="alert" className="rounded-lg bg-attention-tonal px-ops-3 py-ops-3 text-ops-body text-attention">
        Could not check platform health.
      </p>
    );
  }
  const problems = signals.filter((s) => s.active || s.critical);
  const shown = more ? problems : problems.slice(0, 4);
  const hidden = problems.length - shown.length;
  return (
    <section aria-label="Platform health" className="rounded-lg border border-hairline bg-surface px-ops-3 py-2">
      {problems.length === 0 ? (
        <p className="text-ops-body font-medium text-ok">All clear</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {shown.map((signal) => (
            <li key={signal.kind}>
              <button
                type="button"
                onClick={() => setOpen(signal)}
                className="inline-flex min-h-11 items-center gap-1.5 text-ops-label text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT[toneOf(signal)]}`} />
                {signal.title}
              </button>
            </li>
          ))}
          {hidden > 0 ? (
            <li>
              <button type="button" onClick={() => setMore(true)} className="inline-flex min-h-11 items-center text-ops-label font-medium text-accent">
                More
              </button>
            </li>
          ) : null}
        </ul>
      )}
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
            <p className="text-body font-medium text-ink">{wordOf(open)}</p>
            <p className="text-body text-ink">{open.detail}</p>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
