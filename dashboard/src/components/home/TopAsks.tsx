"use client";

import { useState } from "react";
import { CallInsights } from "@/components/insights/CallInsights";
import { Sheet } from "@/components/ui/Sheet";
import { focusRingVisible } from "@/components/ui/deskChrome";
import type { CallInsights as Insights } from "@/lib/callInsights";

/** Half card: three bars from the last 30 days, or the honest wait. */
export function TopAsks({ insights }: { insights: Insights }) {
  const [open, setOpen] = useState(false);
  const products = insights.sections.find((section) => section.id === "products");
  const bars = (products?.bars ?? []).slice(0, 3);
  const max = Math.max(1, ...bars.map((bar) => bar.count));
  return (
    <section aria-labelledby="asks-title" className="min-w-0 overflow-hidden rounded-2xl border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full flex-col px-3 py-3 text-start motion-press ${focusRingVisible}`}
      >
        <h2 id="asks-title" className="text-body font-semibold text-ink">Top asks</h2>
        {!insights.ready || bars.length === 0 ? (
          <p className="mt-2 text-meta text-ink-2">{insights.ready ? "No item named yet." : "After 5 calls"}</p>
        ) : (
          <ul className="mt-2 flex w-full flex-col gap-1.5">
            {bars.map((bar) => (
              <li key={bar.id} className="min-w-0">
                <span className="flex items-baseline justify-between gap-2 text-meta text-ink">
                  <span className="min-w-0 truncate">{bar.label}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">{bar.count}</span>
                </span>
                <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                  <span className="block h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${bar.count / max})` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="What callers told us">
        <CallInsights insights={insights} />
      </Sheet>
    </section>
  );
}
