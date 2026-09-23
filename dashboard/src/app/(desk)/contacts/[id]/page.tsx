import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactFavouriteButton } from "@/components/ContactFavouriteButton";
import { ContactNameForm } from "@/components/ContactNameForm";
import { RowIdentity } from "@/components/ui/deskRow";
import { ContactNotesForm } from "@/components/ContactNotesForm";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";
import { DeskError } from "@/components/ui/DeskError";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callFromContactHref,
  inboxFromContactHref,
  inboxThreadsFromContactHref,
} from "@/lib/inboxHref";
import { isContactFavourite } from "@/lib/contactFavourite";
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
import { displayContactLastReason } from "@/lib/callSummarySentence";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { ContactKpiStrip } from "@/components/ContactKpiStrip";
import { ContactHistory } from "@/components/ContactHistory";
import { ContactSparkline } from "@/components/ContactSparkline";
import {
  contactHistoryChips,
  contactHistoryDailyCounts,
  contactHistoryInsight,
  filterContactTimeline,
  groupContactTimeline,
  lastReasonIsHistoryDuplicate,
  resolveContactHistoryFilter,
  type ContactHistoryFilter,
} from "@/lib/contactHistoryView";
import { sanitizeSearchQuery } from "@/lib/callsTriage";

function fileHref(
  id: string,
  sp: Record<string, string | undefined>,
  extras: { history?: ContactHistoryFilter; hq?: string } = {}
): string {
  const q = new URLSearchParams();
  for (const key of [
    "from",
    "call",
    "purpose",
    "status",
    "view",
    "week",
    "day",
    "q",
    "page",
    "saved",
    "sort",
  ] as const) {
    if (sp[key]) q.set(key, String(sp[key]));
  }
  const history = extras.history ?? resolveContactHistoryFilter(sp.history);
  if (history !== "all") q.set("history", history);
  const hq = extras.hq ?? sanitizeSearchQuery(sp.hq);
  if (hq) q.set("hq", hq);
  const qs = q.toString();
  return qs ? `/contacts/${id}?${qs}` : `/contacts/${id}`;
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
    hq?: string;
    history?: string;
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
  const historyFilter = resolveContactHistoryFilter(sp.history);
  const historyQ = sanitizeSearchQuery(sp.hq);
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
  const showLastReason =
    Boolean(latestCall?.ownerCard?.done || latestCall?.ownerCard?.mood || latestCall?.ownerCard?.next) ||
    !lastReasonIsHistoryDuplicate(lastReason, latestCall);
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
  const visible = filterContactTimeline(timeline, historyFilter, historyQ);
  const historyRows = groupContactTimeline(visible);
  const insight = contactHistoryInsight(timeline);
  const spark = contactHistoryDailyCounts(timeline);
  const chipHrefs = Object.fromEntries(
    contactHistoryChips().map((chip) => [
      chip.id,
      fileHref(id, sp, { history: chip.id, hq: historyQ || undefined }),
    ])
  ) as Record<ContactHistoryFilter, string>;

  return (
    <div className="max-w-6xl min-w-0 overflow-x-clip" data-desk-nested="">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4">
            <DeskRecordLead
              back={<DeskBack href={backHref}>{backLabel}</DeskBack>}
              trail={contact.phone ? <ContactActionDock number={contact.phone} /> : null}
            >
              <div className="flex min-w-0 items-start gap-3">
                <RowIdentity name={contact.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <ContactNameForm contactId={contact.id} initialName={contact.name} />
                  <p className="mt-2 font-mono text-sm text-ink">{contact.phone || "No phone"}</p>
                  {lastCallFact ? (
                    <p className="mt-1 text-sm text-ink-soft">{lastCallFact}</p>
                  ) : null}
                </div>
              </div>
            </DeskRecordLead>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <ContactFavouriteButton
                contactId={contact.id}
                favourite={isContactFavourite(contact.metadata)}
              />
              {threadsHref ? (
                <Link
                  href={threadsHref}
                  data-contact-inbox-threads=""
                  className={`text-sm font-medium text-[#005CCC] ${deskShiftClass} hover:underline focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
                >
                  Inbox threads
                </Link>
              ) : null}
            </div>
            <ContactKpiStrip cards={kpiCards} hrefs={{
                interactions: fileHref(id, sp, { history: "all" }),
                visitsDone: fileHref(id, sp, { history: "job" }),
              }} />
          </div>

          {showLastReason && (latestCall?.ownerCard || lastReason) ? (
            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                Last want
              </h2>
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
            </section>
          ) : null}

          <ContactNotesForm contactId={contact.id} initial={contact.notes || ""} />
        </aside>

        <div className="min-h-0 min-w-0 space-y-6 lg:col-span-8">
          {insight || spark.some((day) => day.count > 0) ? (
            <div className="space-y-3">
              <ContactSparkline days={spark} />
              {insight ? (
                <p className="rounded-2xl border border-warn/40 bg-warn-soft px-3 py-3 text-sm text-warn">
                  {insight}
                </p>
              ) : null}
            </div>
          ) : null}
          <ContactHistory
            rows={historyRows}
            filter={historyFilter}
            q={historyQ}
            chipHrefs={chipHrefs}
          />
        </div>
      </div>
    </div>
  );
}
