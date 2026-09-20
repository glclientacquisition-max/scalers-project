import { notFound } from "next/navigation";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactNameForm } from "@/components/ContactNameForm";
import { DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";
import { DeskBack } from "@/components/ui/DeskBack";
import { isJunkCallerName } from "@/lib/callerNameQuality";

export const dynamic = "force-dynamic";

function ProfileLead({
  title,
  phone,
  contactId,
  name,
}: {
  title: string;
  phone: string;
  contactId: string;
  name: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 font-mono text-sm text-ink">{phone}</p>
      </div>
      <ContactActionDock number={phone} />
      {isJunkCallerName(name) ? <ContactNameForm contactId={contactId} /> : null}
    </div>
  );
}

export default function DevContactsPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      <DeskRail needsCount={0} homeHref="/dev/contacts" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main className={deskMainClass}>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <section className="max-w-md space-y-5">
              <DeskBack href="/dev/contacts">Contacts</DeskBack>
              <ProfileLead
                title="Unknown"
                phone="+254700000001"
                contactId="ct-unsaved"
                name={null}
              />
              <section className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  Last reason
                </h2>
                <CallSummaryCard
                  name={null}
                  callerNumber="+254700000001"
                  want="Callback"
                  done={null}
                  mood="Urgent"
                  next="Call them back"
                />
              </section>
            </section>
            <section className="max-w-md space-y-5">
              <DeskBack href="/dev/contacts">Contacts</DeskBack>
              <ProfileLead
                title="Amina"
                phone="+254700000002"
                contactId="ct-saved"
                name="Amina"
              />
              <section className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  Last reason
                </h2>
                <CallSummaryCard
                  name="Amina"
                  callerNumber="+254700000002"
                  want="Missed the line"
                  done={null}
                  mood="Urgent"
                  next="Call them back"
                />
              </section>
            </section>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
