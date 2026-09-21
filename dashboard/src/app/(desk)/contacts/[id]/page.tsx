import { notFound } from "next/navigation";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactNameForm } from "@/components/ContactNameForm";
import { ContactNotesForm } from "@/components/ContactNotesForm";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewCellClass } from "@/components/ui/deskChrome";
import { DeskBack } from "@/components/ui/DeskBack";
import { DeskError } from "@/components/ui/DeskError";
import { isJunkCallerName } from "@/lib/callerNameQuality";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { formatCallWhen } from "@/lib/callsTriage";
import { callFromContactHref, inboxFromContactHref } from "@/lib/inboxHref";
import {
  contactLastCallFact,
  contactsReturnHref,
  loadContactById,
  loadContactTimeline,
} from "@/lib/contactsLoad";
import { contactStripTitle } from "@/lib/contactStrip";
import { displayContactLastReason } from "@/lib/callSummarySentence";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { ContactTimelineWhat } from "@/components/ContactTimelineWhat";

function kindLabel(kind: "call" | "request" | "appointment"): string {
  if (kind === "request") return "Request";
  if (kind === "appointment") return "Visit";
  return "Call";
}

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

  const timeline = await loadContactTimeline(workspace.client, tenant.id, contact);
  const title = contactStripTitle(contact.name, true);
  const latestCall = timeline.find((entry) => entry.kind === "call");
  const lastCallFact = contactLastCallFact(latestCall?.createdAt);
  const lastReason = displayContactLastReason({
    name: contact.name,
    phone: contact.phone,
    lastReason: contact.last_reason,
    latestCallReason: latestCall?.ownerReason || latestCall?.ownerWant || null,
  });
  return (
    <div className="max-w-6xl">
      <DeskBack href={backHref}>{backLabel}</DeskBack>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4">
            <div>
              <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
                {title}
              </h1>
              <p className="mt-2 font-mono text-sm text-ink">{contact.phone || "No phone"}</p>
              {lastCallFact ? (
                <p className="mt-1 text-sm text-ink-soft">{lastCallFact}</p>
              ) : null}
            </div>
            {contact.phone ? <ContactActionDock number={contact.phone} /> : null}
            {isJunkCallerName(contact.name) ? (
              <ContactNameForm contactId={contact.id} />
            ) : null}
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

        <div className="min-h-0 space-y-8 lg:col-span-8 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section>
            <h2 className="font-display text-2xl tracking-tight text-ink">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="mt-4 text-sm text-ink-soft">No calls or jobs yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                    <tr>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                      >
                        When
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                      >
                        Type
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                      >
                        What
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((entry) => (
                      <tr
                        key={entry.id}
                        className={[
                          "relative border-t border-line/70",
                          entry.callId ? "cursor-pointer hover:bg-accent/[0.04]" : "",
                        ].join(" ")}
                      >
                        <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-4 text-ink-soft`}>
                          {entry.callId ? (
                            <DeskRowHit href={`/calls/${entry.callId}`} label="Conversation" />
                          ) : null}
                          {formatCallWhen(entry.createdAt)}
                        </td>
                        <td className={`${deskRowMutedClass} px-5 py-4 text-ink`}>{kindLabel(entry.kind)}</td>
                        <td className={`${deskPreviewCellClass} px-5 py-4`}>
                          <ContactTimelineWhat headline={entry.headline} detail={entry.detail} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
