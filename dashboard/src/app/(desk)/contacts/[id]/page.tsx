import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactNameForm } from "@/components/ContactNameForm";
import { ContactNotesForm } from "@/components/ContactNotesForm";
import { btnGhost } from "@/components/ui/deskChrome";
import { DeskBack } from "@/components/ui/DeskBack";
import { DeskError } from "@/components/ui/DeskError";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callFromContactHref,
  inboxFromContactHref,
  inboxThreadsFromContactHref,
} from "@/lib/inboxHref";
import {
  contactLastCallFact,
  contactsReturnHref,
  loadContactById,
  loadContactTimeline,
} from "@/lib/contactsLoad";
import {
  contactPersonFileKpiCards,
  pickFirstSeenAt,
} from "@/lib/contactPersonFile";
import { contactStripTitle } from "@/lib/contactStrip";
import { displayContactLastReason } from "@/lib/callSummarySentence";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { ContactKpiStrip } from "@/components/ContactKpiStrip";
import { ContactTimeline } from "@/components/ContactTimeline";

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    from?: string;
    call?: string;
    purpose?: string;
    status?: string;
    view?: string;
    week?: string;
    day?: string;
    q?: string;
    page?: string;
    saved?: string;
    sort?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const callBack = callFromContactHref(sp);
  const inboxBack = inboxFromContactHref(sp);
  const backHref = callBack || inboxBack || contactsReturnHref(sp);
  const backLabel = callBack ? "Call" : inboxBack ? "Inbox" : "Contacts";
  const tenant = await getCurrentTenant();
  if (!tenant) notFound();

  const workspace = await createWorkspaceDataClient();
  if (!workspace) notFound();

  const { contact, error } = await loadContactById(workspace.client, tenant.id, id);
  if (error) {
    return <DeskError>Could not load this contact.</DeskError>;
  }
  if (!contact) notFound();

  const timeline = await loadContactTimeline(
    workspace.client,
    tenant.id,
    contact,
    tenant.vertical
  );
  const title = contactStripTitle(contact.name, true);
  const latestCall = timeline.find(
    (entry) => entry.kind === "call" || entry.ownerCard || entry.ownerReason
  );
  const lastCallFact = contactLastCallFact(latestCall?.createdAt);
  const lastReason = displayContactLastReason({
    name: contact.name,
    phone: contact.phone,
    lastReason: contact.last_reason,
    latestCallReason: latestCall?.ownerReason || latestCall?.ownerWant || null,
  });
  const threadsHref = inboxThreadsFromContactHref(contact.phone);
  const kpiCards = contactPersonFileKpiCards({
    interactionCount: timeline.length,
    visitsDoneCount: timeline.filter(
      (entry) => String(entry.jobStatus || "").toLowerCase() === "done"
    ).length,
    firstSeenAt: pickFirstSeenAt(
      contact.created_at,
      ...timeline.map((entry) => entry.createdAt)
    ),
  });
  return (
    <div className="max-w-6xl min-w-0 overflow-x-clip" data-desk-nested="">
      <DeskBack href={backHref}>{backLabel}</DeskBack>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
                  {title}
                </h1>
                <p className="mt-2 font-mono text-sm text-ink">{contact.phone || "No phone"}</p>
                {lastCallFact ? (
                  <p className="mt-1 text-sm text-ink-soft">{lastCallFact}</p>
                ) : null}
              </div>
              {contact.phone ? <ContactActionDock number={contact.phone} /> : null}
            </div>
            {threadsHref ? (
              <Link
                href={threadsHref}
                data-contact-inbox-threads=""
                className={`${btnGhost} w-full sm:w-auto`}
              >
                Inbox threads
              </Link>
            ) : null}
            <ContactNameForm contactId={contact.id} initialName={contact.name} />
            <ContactKpiStrip cards={kpiCards} />
          </div>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Last reason
            </h2>
            {latestCall?.ownerCard || lastReason ? (
              <CallSummaryCard
                name={contact.name}
                callerNumber={contact.phone || "unknown"}
                want={
                  latestCall?.ownerCard?.want ||
                  latestCall?.ownerWant ||
                  contact.last_reason
                }
                done={latestCall?.ownerCard?.done}
                mood={latestCall?.ownerCard?.mood}
                next={latestCall?.ownerCard?.next}
              />
            ) : (
              <p className="mt-3 text-base leading-relaxed text-ink">None</p>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <ContactNotesForm contactId={contact.id} initial={contact.notes || ""} />
          </section>
        </aside>

        <div className="min-h-0 min-w-0 space-y-8 lg:col-span-8 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section>
            <h2 className="font-display text-2xl tracking-tight text-ink">History</h2>
            <ContactTimeline entries={timeline} />
          </section>
        </div>
      </div>
    </div>
  );
}
