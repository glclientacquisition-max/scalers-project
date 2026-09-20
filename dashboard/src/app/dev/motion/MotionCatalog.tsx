"use client";

import { useMemo, useState } from "react";
import { DeskPhoneHeader, DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";
import { btnGhost, btnPrimary, deskShiftClass, pendingSpinnerClass } from "@/components/ui/deskChrome";
import { DeskLandScope, DeskLandSurface } from "@/components/ui/DeskLand";
import { useNotify } from "@/components/ui/DeskNotice";
import { LivePing, RowIdentity, RowStateDot } from "@/components/ui/deskRow";

const SEED = ["seed-a", "seed-b"];

export function MotionCatalog() {
  const [ids, setIds] = useState<string[]>(SEED);
  const [pending, setPending] = useState(false);
  const { notify } = useNotify();
  const scopeKey = "catalog";
  const extra = useMemo(() => ids.filter((id) => !SEED.includes(id)), [ids]);

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      <DeskRail homeHref="/dev/motion" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <DeskPhoneHeader homeHref="/dev/motion" />
        <main className={deskMainClass}>
        <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-tight text-ink">
          Motion
        </h1>

        <section className="mt-8" aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Pending
          </h2>
          <button
            type="button"
            className={`${btnPrimary} mt-3`}
            onClick={() => {
              setPending(true);
              window.setTimeout(() => setPending(false), 1200);
            }}
            disabled={pending}
          >
            {pending ? <span aria-hidden="true" className={pendingSpinnerClass} /> : null}
            {pending ? "Saving" : "Save"}
          </button>
        </section>

        <section className="mt-8" aria-labelledby="live-heading">
          <h2 id="live-heading" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Live
          </h2>
          <p className="mt-3 flex items-center gap-2 text-sm text-ink">
            <LivePing />
            Updates
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink">
            <RowStateDot show live />
            Live call
          </p>
        </section>

        <section className="mt-8" aria-labelledby="land-heading">
          <h2 id="land-heading" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Land
          </h2>
          <button
            type="button"
            className={`${btnPrimary} mt-3`}
            onClick={() =>
              setIds((prev) => [`land-${prev.length + 1}-${Date.now()}`, ...prev])
            }
          >
            Add row
          </button>
          <DeskLandScope ids={ids} scopeKey={scopeKey}>
            <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
              {ids.map((id) => (
                <DeskLandSurface
                  as="li"
                  key={id}
                  id={id}
                  className="relative flex items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0"
                >
                  <RowIdentity name={SEED.includes(id) ? "Amina" : "Otieno"} />
                  <p className="text-sm font-semibold text-ink">
                    {SEED.includes(id) ? "Seed" : "Just landed"}
                  </p>
                </DeskLandSurface>
              ))}
            </ul>
          </DeskLandScope>
          {extra.length > 0 ? (
            <p className="mt-2 text-xs text-ink-soft">{extra.length} landed</p>
          ) : null}
        </section>

        <section className="mt-8" aria-labelledby="shift-heading">
          <h2 id="shift-heading" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Shift
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={btnGhost}>
              Ghost
            </button>
            <button
              type="button"
              className={`${deskShiftClass} rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:bg-accent/[0.04] hover:text-ink`}
            >
              Chip
            </button>
          </div>
          <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
            <li
              className={`${deskShiftClass} flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium text-ink hover:bg-accent/[0.04]`}
            >
              Queue row
            </li>
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="press-heading">
          <h2 id="press-heading" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Press
          </h2>
          <button type="button" className={`${btnPrimary} mt-3`}>
            Reply on WhatsApp
          </button>
        </section>

        <section className="mt-8" aria-labelledby="notice-heading">
          <h2 id="notice-heading" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Notice
          </h2>
          <button type="button" className={`${btnPrimary} mt-3`} onClick={() => notify("Saved")}>
            Notify
          </button>
        </section>
        </main>
        <DeskTabBar />
      </div>
    </div>
  );
}
