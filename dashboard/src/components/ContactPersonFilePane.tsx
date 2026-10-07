import Link from "next/link";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactFavouriteButton } from "@/components/ContactFavouriteButton";
import { ContactNameForm } from "@/components/ContactNameForm";
import { RowIdentity } from "@/components/ui/deskRow";
import { ContactNotesForm } from "@/components/ContactNotesForm";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskRecovery } from "@/components/ui/DeskRecovery";
import { PageHeader } from "@/components/ui/PageHeader";
import { Empty } from "@/components/ui/Empty";
import { ButtonLink } from "@/components/ui/Button";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inboxThreadsFromContactHref } from "@/lib/inboxHref";
import { isContactFavourite } from "@/lib/contactFavourite";
import {
  contactLastCallFact,
  contactProfileHref,
  contactsSplitHistoryHref,
  loadContactById,
  loadContactTimeline,
  resolveContactSavedFilter,
  resolveContactSort,
} from "@/lib/contactsLoad";
import {
  contactPersonFileKpiCards,
  pickFirstSeenAt,
} from "@/lib/contactPersonFile";
import {
  displayContactLastReason,
  usefulMoodLabel,
  usefulOwnerFact,
} from "@/lib/callSummarySentence";
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

export async function ContactPersonFilePane({
  tenantId,
  vertical,
  client,
  contactId,
  listSaved,
  listSort,
  listQ,
  historyRaw,
  hqRaw,
}: {
  tenantId: string;
  vertical: string | null | undefined;
  client: SupabaseClient;
  contactId: string;
  listSaved?: string;
  listSort?: string;
  listQ?: string;
  historyRaw?: string;
  hqRaw?: string;
}) {
  const saved = resolveContactSavedFilter(listSaved);
  const sort = resolveContactSort(listSort);
  const listReturn = { saved, sort, q: sanitizeSearchQuery(listQ) || undefined };
  const historyFilter = resolveContactHistoryFilter(historyRaw);
  const historyQ = sanitizeSearchQuery(hqRaw);

  const { contact, error } = await loadContactById(client, tenantId, contactId);
  if (error) {
    return <DeskLoadError>Could not load this contact.</DeskLoadError>;
  }
  if (!contact) {
    return (
      <DeskRecovery title="This contact is not in Contacts." href="/contacts" action="Contacts" />
    );
  }

  const timeline = await loadContactTimeline(client, tenantId, contact, vertical);
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
  const ownerDone = usefulOwnerFact(latestCall?.ownerCard?.done);
  const ownerNext = usefulOwnerFact(latestCall?.ownerCard?.next);
  const ownerMood = usefulMoodLabel(latestCall?.ownerCard?.mood);
  const showLastReason =
    Boolean(ownerDone || ownerNext || ownerMood) ||
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
      contactsSplitHistoryHref(contactId, {
        ...listReturn,
        history: chip.id,
        hq: historyQ || undefined,
      }),
    ])
  ) as Record<ContactHistoryFilter, string>;

  return (
    <div
      className="min-h-0 min-w-0 overflow-y-auto rounded-2xl border border-hairline bg-canvas lg:max-h-[calc(100dvh-8rem)] lg:p-4"
      data-contact-split-pane=""
    >
      <PageHeader
        title={contact.name?.trim() || "Unknown caller"}
        meta={contact.phone || undefined}
        action={
          contact.phone ? <ContactActionDock number={contact.phone} /> : undefined
        }
      />
      <div className="mt-4 space-y-5">
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-hairline bg-surface p-4">
          <RowIdentity name={contact.name} size="lg" />
          <div className="min-w-0 flex-1">
            <ContactNameForm contactId={contact.id} initialName={contact.name} />
            {lastCallFact ? <p className="mt-2 text-meta text-ink-2">{lastCallFact}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ContactFavouriteButton
            contactId={contact.id}
            favourite={isContactFavourite(contact.metadata)}
          />
          {threadsHref ? (
            <Link
              href={threadsHref}
              className={`text-sm font-medium text-accent ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
            >
              Inbox threads
            </Link>
          ) : null}
          <ButtonLink
            href={contactProfileHref(contact.id, listReturn)}
            variant="ghost"
            size="sm"
          >
            Open full file
          </ButtonLink>
        </div>
        <ContactKpiStrip
          cards={kpiCards}
          hrefs={{
            interactions: contactsSplitHistoryHref(contactId, { ...listReturn, history: "all" }),
            visitsDone: contactsSplitHistoryHref(contactId, { ...listReturn, history: "job" }),
          }}
        />
        {showLastReason && (latestCall?.ownerCard || lastReason) ? (
          <section className="rounded-2xl border border-hairline bg-surface p-4">
            <h2 className="text-caption font-medium text-ink-2">Last want</h2>
            <CallSummaryCard
              name={contact.name}
              callerNumber={contact.phone || "unknown"}
              want={
                latestCall?.ownerCard?.want ||
                latestCall?.ownerWant ||
                contact.last_reason
              }
              done={ownerDone || null}
              mood={ownerMood || null}
              next={ownerNext || null}
            />
          </section>
        ) : null}
        <ContactNotesForm contactId={contact.id} initial={contact.notes || ""} />
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
  );
}

export function ContactsSplitPlaceholder() {
  return (
    <div
      className="hidden min-h-[20rem] items-center justify-center rounded-2xl border border-dashed border-hairline bg-canvas lg:flex"
      aria-hidden="true"
    >
      <Empty title="Select a contact" />
    </div>
  );
}
