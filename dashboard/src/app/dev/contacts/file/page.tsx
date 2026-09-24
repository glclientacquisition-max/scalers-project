import { notFound } from "next/navigation";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactFavouriteButton } from "@/components/ContactFavouriteButton";
import { ContactNameForm } from "@/components/ContactNameForm";
import { ContactKpiStrip } from "@/components/ContactKpiStrip";
import { RowIdentity } from "@/components/ui/deskRow";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";
import {
  contactPersonFileKpiCards,
  pickFirstSeenAt,
} from "@/lib/contactPersonFile";

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
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/contacts" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main className={deskMainClass}>
          <div className="max-w-6xl min-w-0 overflow-x-clip" data-desk-nested="">
            <div className="space-y-4">
              <DeskRecordLead
                back={<DeskBack href="/dev/contacts">Contacts</DeskBack>}
                trail={<ContactActionDock number="+254700000002" />}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <RowIdentity name="Amina" size="lg" />
                  <div className="min-w-0 flex-1">
                    <ContactNameForm
                      contactId="ct-saved"
                      initialName="Amina"
                      title="Amina"
                    />
                    <p className="mt-2 font-mono text-sm text-ink">+254700000002</p>
                  </div>
                </div>
              </DeskRecordLead>
              <ContactFavouriteButton contactId="ct-saved" favourite={false} />
              <ContactKpiStrip cards={cards} />
            </div>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
