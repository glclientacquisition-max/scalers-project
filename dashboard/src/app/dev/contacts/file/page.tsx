import { notFound } from "next/navigation";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactKpiStrip } from "@/components/ContactKpiStrip";
import { DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";
import { DeskBack } from "@/components/ui/DeskBack";
import {
  contactPersonFileKpiCards,
  pickFirstSeenAt,
} from "@/lib/contactPersonFile";

export const dynamic = "force-dynamic";

/**
 * Nested contact file harness (no desk login). DASHBOARD_OPEN=true only.
 * Phone tabs should hide. The md+ rail stays.
 */
export default function DevContactFilePage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  const cards = contactPersonFileKpiCards({
    interactionCount: 3,
    visitsDoneCount: 1,
    firstSeenAt: pickFirstSeenAt("2026-01-21T07:00:00.000Z"),
    now: new Date("2026-09-21T08:00:00+03:00"),
  });

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      <DeskRail needsCount={0} homeHref="/dev/contacts" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main className={deskMainClass}>
          <div className="max-w-6xl min-w-0 overflow-x-clip" data-desk-nested="">
            <DeskBack href="/dev/contacts">Contacts</DeskBack>
            <div className="mt-6 space-y-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
                    Amina
                  </h1>
                  <p className="mt-2 font-mono text-sm text-ink">+254700000002</p>
                </div>
                <ContactActionDock number="+254700000002" />
              </div>
              <ContactKpiStrip cards={cards} />
            </div>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
