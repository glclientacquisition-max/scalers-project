import { notFound } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { InboxTicketView } from "@/components/InboxTicketView";
import { DeskNav, DeskTabBar } from "@/components/DeskNav";
import { InboxToolbar } from "@/components/InboxToolbar";
import { InboxPhoneRow, InboxTableRow } from "@/components/InboxItemRow";
import { InboxArchivedPhoneRow, InboxArchivedTableRow } from "@/components/InboxArchivedRow";
import { InboxRowUiProvider } from "@/components/InboxRowUi";
import { InboxSelectChrome } from "@/components/InboxRowSelect";
import { ThemePicker } from "@/components/ThemePicker";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import type { InboxItem } from "@/lib/inboxPurpose";
import type { TranscriptRow } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function item(partial: Partial<InboxItem> & Pick<InboxItem, "id" | "purpose" | "headline">): InboxItem {
  return {
    createdAt: "2026-09-12T05:10:00.000Z",
    needsYou: true,
    callerName: "Amina",
    callerPhone: "254700000001",
    contactId: null,
    detail: null,
    callId: "call-1",
    lead: null,
    hold: null,
    job: null,
    intent: null,
    urgent: false,
    unread: false,
    muted: false,
    pinnedAt: null,
    assignee: null,
    labels: [],
    snoozedUntil: null,
    ...partial,
  };
}

const ROWS: InboxItem[] = [
  item({
    id: "live",
    purpose: "live",
    callerName: "Amina",
    headline: "On the line",
    intent: null,
  }),
  item({
    id: "human",
    purpose: "human",
    callerName: "Amina",
    headline: "Asked for a person",
    intent: "human",
    pinnedAt: "2026-09-18T08:00:00.000Z",
  }),
  item({
    id: "job",
    purpose: "job",
    callerName: "Otieno",
    callerPhone: "254700000002",
    contactId: "ct-otieno",
    headline: "House cleaning",
    intent: "book_visit",
    job: {
      id: "job-1",
      created_at: "2026-09-12T05:10:00.000Z",
      service_name: "House cleaning",
      status: "requested",
      when_text: "Tomorrow 9am",
      address_landmark: "Kericho road",
      notes: null,
      caller_name: "Otieno",
      caller_phone: "254700000002",
      call_id: "call-1",
    },
  }),
  item({
    id: "job-intent",
    purpose: "job",
    callerName: "Alvin",
    callerPhone: "254700000004",
    headline: "Visit",
    intent: "book_visit",
  }),
  item({
    id: "hold",
    purpose: "hold",
    callerName: "Wanjiku",
    callerPhone: "254700000003",
    headline: "5L bleach",
    intent: "hold_or_pickup",
    hold: {
      id: "hold-1",
      created_at: "2026-09-12T05:10:00.000Z",
      request_type: "hold_or_pickup",
      status: "open",
      item: "5L bleach",
      quantity: "1",
      when_text: "Today 4pm",
      notes: null,
      caller_name: "Wanjiku",
      caller_phone: "254700000003",
      call_id: "call-1",
    },
  }),
  item({
    id: "archived",
    purpose: "human",
    needsYou: false,
    callerName: "Njeri",
    callerPhone: "254700000006",
    headline: "Asked for a person",
    intent: "human",
    lead: { leadStatus: "archived" } as InboxItem["lead"],
  }),
  item({
    id: "long-reason",
    purpose: "answered",
    needsYou: false,
    callerName: "Mwangi",
    callerPhone: "254700000005",
    headline:
      "Caller wants a deep clean of the three bedroom house in Westlands this Saturday morning and asked the receptionist to confirm the team and send the quote on WhatsApp.",
    intent: "book_visit",
  }),
];

const TURNS: TranscriptRow[] = [
  {
    id: "t1",
    created_at: "2026-09-12T05:10:01.000Z",
    call_id: "call-1",
    speaker: "caller",
    text_content: "Hi, I need house cleaning tomorrow morning.",
    latency_ms: null,
  },
  {
    id: "t2",
    created_at: "2026-09-12T05:10:08.000Z",
    call_id: "call-1",
    speaker: "agent",
    text_content: "I can book a visit for tomorrow at 9am. Kericho road still okay?",
    latency_ms: 400,
  },
  {
    id: "t3",
    created_at: "2026-09-12T05:10:16.000Z",
    call_id: "call-1",
    speaker: "caller",
    text_content: "Yes. Please confirm on WhatsApp.",
    latency_ms: null,
  },
  {
    id: "t4",
    created_at: "2026-09-12T05:10:22.000Z",
    call_id: "call-1",
    speaker: "agent",
    text_content: "Visit saved for tomorrow 9am. I will send the confirmation.",
    latency_ms: 380,
  },
  {
    id: "t5",
    created_at: "2026-09-12T05:10:28.000Z",
    call_id: "call-1",
    speaker: "caller",
    text_content: "Thank you.",
    latency_ms: null,
  },
  {
    id: "t6",
    created_at: "2026-09-12T05:10:31.000Z",
    call_id: "call-1",
    speaker: "system",
    text_content: "Call ended",
    latency_ms: null,
  },
];

export default function DevInboxPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  const needYou = ROWS.filter((row) => row.needsYou).length;
  const briefing = needYou > 0 ? `${needYou} need you` : "Clear";

  return (
    <div className="desk-theme min-h-screen min-w-0">
      <header className="sticky top-0 z-40 isolate border-b border-line/80 bg-surface shadow-none">
        <div className="relative mx-auto flex max-w-desk items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <BrandLockup href="/dev/inbox" name="Scalers" size="sm" priority className="max-w-full" />
          <DeskNav />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-desk px-4 pt-6 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-10">
        <InboxRowUiProvider>
        <InboxSelectChrome items={ROWS}>
        <InboxToolbar
          active="needs"
          counts={{
            needs: needYou,
            all: ROWS.length,
            job: 1,
            hold: 1,
            human: 1,
            answered: 1,
            archived: 14,
          }}
          q=""
          caption={briefing}
        />
        <div className="mt-6 max-w-lg">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Appearance</p>
          <div className="mt-2">
            <ThemePicker />
          </div>
        </div>
        </InboxSelectChrome>
        <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface lg:hidden">
          <InboxArchivedPhoneRow count={14} />
          {ROWS.map((row) => (
            <InboxPhoneRow
              key={row.id}
              item={row}
              businessName="Workspace"
              purpose={row.purpose === "job" ? "job" : row.purpose === "hold" ? "hold" : "needs"}
              ret={{ purpose: row.purpose === "job" ? "job" : row.purpose === "hold" ? "hold" : "needs" }}
            />
          ))}
        </ul>
        <div className="mt-8 hidden lg:block">
          <DeskDataTable minWidthClass="min-w-0">
            <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
              <tr>
                <th scope="col" className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-[0.14em]">Work</th>
                <th scope="col" className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-[0.14em]">Caller</th>
                <th scope="col" className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-[0.14em]">When</th>
                <th scope="col" className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-[0.14em]">Action</th>
              </tr>
            </thead>
              <tbody>
                <InboxArchivedTableRow count={14} />
                {ROWS.map((row) => (
                <InboxTableRow
                  key={row.id}
                  item={row}
                  businessName="Workspace"
                  purpose="needs"
                  vertical={null}
                  ret={{ purpose: "needs" }}
                />
              ))}
            </tbody>
          </DeskDataTable>
        </div>
        </InboxRowUiProvider>
        <div className="mt-10">
          <InboxTicketView
            callId="call-1"
            backHref="/dev/inbox"
            contactHref="/dev/inbox"
            title="Otieno"
            stamp="Confirm visit"
            purpose="job"
            callerPhone="254700000002"
            waMessage="House cleaning"
            needsYou
            urgency="Confirm the visit"
            want="House cleaning tomorrow 9am"
            done="Visit saved"
            mood="Calm"
            job={{
              id: "job-1",
              created_at: "2026-09-12T05:10:00.000Z",
              service_name: "House cleaning",
              status: "requested",
              when_text: "Tomorrow 9am",
              address_landmark: "Kericho road",
              notes: null,
              caller_name: "Otieno",
              caller_phone: "254700000002",
              call_id: "call-1",
            }}
            hold={null}
            turns={TURNS}
            tenantId="dev"
            recordingUrl={null}
            durationLabel="48s"
            assistLabel="Handled"
            assistNote={null}
            escalatedLine={null}
            archived={false}
          />
        </div>
      </main>
      <DeskTabBar />
    </div>
  );
}
