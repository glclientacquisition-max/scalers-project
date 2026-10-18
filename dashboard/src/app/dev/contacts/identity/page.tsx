import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactFavouriteButton } from "@/components/ContactFavouriteButton";
import { ContactIdentityPanel } from "@/components/ContactIdentityPanel";
import { ContactNameForm } from "@/components/ContactNameForm";
import { RowIdentity } from "@/components/ui/deskRow";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";
import { readContactIdentity, visibleAlternates } from "@/lib/contactNameLock";

/**
 * Contact identity lock fixture (DESK_CONTACT_NAME_LOCK UI). DASHBOARD_OPEN=true only.
 * ?state=heard (Alwyn, also heard as Alvin) | locked | many | none
 */
const FIXTURES: Record<string, { name: string; metadata: Record<string, unknown> }> = {
  heard: {
    name: "Alwyn",
    metadata: {
      alternate_names: [
        { name: "Alvin", seen_at: "2026-10-17T17:01:08.493Z", call_id: "63f24644-86fe-4615-be2f-2030c92a1f0c" },
      ],
    },
  },
  locked: {
    name: "Alwyn",
    metadata: { single_person: true, name_locked: { at: "2026-10-18T12:20:00.000Z", by: "owner" }, alternate_names: [] },
  },
  many: {
    name: "Wanjiru",
    metadata: {
      alternate_names: [
        { name: "Grace", seen_at: "2026-10-16T08:28:19.895Z", call_id: "e82962c4-4be3-4d37-88d1-6f649c2c8683" },
        { name: "Otieno", seen_at: "2026-10-12T19:57:28.417Z", call_id: "65836c62-c460-4e17-b6f0-a0e7339f4aa0" },
        { name: "Hamilton Apartment", seen_at: "2026-10-03T15:56:09.095Z", call_id: null },
      ],
      alternate_names_dismissed: [{ name: "Mteja", at: "2026-10-10T09:00:00.000Z" }],
    },
  },
  none: { name: "Amina", metadata: {} },
};

export default async function DevContactIdentityPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const fixture = FIXTURES[sp.state || "heard"] ?? FIXTURES.heard;
  const identity = readContactIdentity(fixture.metadata);
  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/contacts" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <div className="max-w-6xl min-w-0 overflow-x-clip" data-desk-nested="">
            <div className="max-w-md space-y-4">
              <DeskRecordLead
                back={<DeskBack href="/dev/contacts">Contacts</DeskBack>}
                trail={<ContactActionDock number="+254700000002" />}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <RowIdentity name={fixture.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <ContactNameForm contactId="dev-identity" initialName={fixture.name} title={fixture.name} />
                    <p className="mt-2 font-mono text-body text-ink">+254700000002</p>
                  </div>
                </div>
              </DeskRecordLead>
              <ContactFavouriteButton contactId="dev-identity" favourite={false} />
              <ContactIdentityPanel
                contactId="dev-identity"
                name={fixture.name}
                singlePerson={identity.singlePerson}
                lockedAt={identity.nameLocked?.at ?? null}
                alternates={visibleAlternates(fixture.metadata)}
              />
            </div>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
