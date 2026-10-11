"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { buttonClass } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { gateStatusLabel, type CapabilityGate } from "@/lib/capabilityGates";

/** One status for a gate. Used on Overview rows and inside the sheet. */
export function CapabilityStamp({ gate }: { gate: Pick<CapabilityGate, "status"> }) {
  return <Stamp tone={gate.status === "live" ? "ok" : "attention"}>{gateStatusLabel(gate)}</Stamp>;
}

export function CapabilityGateSheet({
  gate,
  open,
  onOpenChange,
}: {
  gate: CapabilityGate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const live = gate.status === "live";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={gate.title}
      description={live ? "Your Business Assistant can do this now." : `${gate.missing.length} ${gate.missing.length === 1 ? "step" : "steps"} left before your Business Assistant can do this.`}
    >
      <div className="space-y-5">
        <div>
          <p className="text-meta font-medium text-ink-2">When a caller asks &ldquo;{gate.question}&rdquo;</p>
          <div className="mt-2 rounded-xl bg-surface-2 px-4 py-3">
            <p className="text-meta text-ink-2">Callers hear now</p>
            <p className="mt-0.5 text-body text-ink">{live ? gate.callerHearsLive : gate.callerHearsLocked}</p>
          </div>
          {!live ? (
            <div className="mt-2 rounded-xl border border-hairline px-4 py-3">
              <p className="text-meta text-ink-2">Once set up</p>
              <p className="mt-0.5 text-body text-ink">{gate.callerHearsLive}</p>
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-meta font-medium text-ink-2">What it needs</p>
          <ul className="mt-2 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {gate.requirements.map((req) => (
              <li key={req.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                {req.done ? (
                  <CheckCircleIcon className="h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border-2 border-ink-3" aria-hidden="true" />
                )}
                <span className={req.done ? "min-w-0 flex-1 text-body text-ink-2" : "min-w-0 flex-1 text-body text-ink"}>
                  <span className="sr-only">{req.done ? "Done: " : "Missing: "}</span>
                  {req.label}
                </span>
                {!req.done && req.href ? (
                  <Link href={req.href} className={buttonClass({ variant: "tonal", size: "sm" })} onClick={() => onOpenChange(false)}>
                    {req.fixLabel}
                  </Link>
                ) : null}
                {!req.done && !req.href ? <span className="shrink-0 text-meta text-ink-2">Scalers</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}

/** "What your Business Assistant can do": one tappable row per gate. */
export function CapabilityGatesPanel({ gates, title = "What your Business Assistant can do" }: { gates: CapabilityGate[]; title?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!gates.length) return null;
  const active = gates.find((g) => g.id === openId) || null;
  return (
    <section className="mt-8" aria-labelledby="capability-gates-heading">
      <h3 id="capability-gates-heading" className="text-title text-ink">
        {title}
      </h3>
      <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {gates.map((g) => (
          <ListRow
            key={g.id}
            onOpen={() => setOpenId(g.id)}
            ariaLabel={`${g.title}: ${gateStatusLabel(g)}. Show details`}
            title={g.title}
            preview={g.status === "live" ? g.question : `${g.missing.length} ${g.missing.length === 1 ? "step" : "steps"} left`}
            stamp={<CapabilityStamp gate={g} />}
          />
        ))}
      </ul>
      {active ? (
        <CapabilityGateSheet gate={active} open={Boolean(active)} onOpenChange={(next) => !next && setOpenId(null)} />
      ) : null}
    </section>
  );
}
