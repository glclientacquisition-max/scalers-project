import { notFound } from "next/navigation";
import { CallerNoteComposer } from "@/components/CallerNoteComposer";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { CallTranscript } from "@/components/CallTranscript";
import { DeskPhoneHeader, DeskRail, DeskTabBar } from "@/components/DeskNav";
import { InboxSplit } from "@/components/InboxSplit";
import { InboxJobActions } from "@/components/InboxJobActions";
import { InboxPhoneRow } from "@/components/InboxItemRow";
import { ThemePicker } from "@/components/ThemePicker";
import { WhatsAppLink } from "@/components/WhatsAppLink";
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
  }),
  item({
    id: "job",
    purpose: "job",
    callerName: "Otieno",
    callerPhone: "254700000002",
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

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 md:h-dvh">
      <DeskRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip md:overflow-hidden">
        <DeskPhoneHeader />
        <main className="min-w-0 flex-1 pb-[var(--desk-tabbar-clearance)] md:overflow-hidden md:p-0">
          <InboxSplit
            list={
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pt-4">
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Inbox</h1>
                <p className="mt-1 text-[13px] leading-5 text-ink-soft">5 need you</p>
                <div className="mt-4 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Appearance</p>
                  <div className="mt-2">
                    <ThemePicker />
                  </div>
                </div>
                <ul
                  aria-label="Conversations"
                  className="mt-6 min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-2xl border border-line bg-surface"
                >
                  {ROWS.map((row) => (
                    <InboxPhoneRow
                      key={row.id}
                      item={row}
                      businessName="Workspace"
                      purpose={row.purpose === "job" ? "job" : row.purpose === "hold" ? "hold" : "needs"}
                      ret={{
                        purpose: row.purpose === "job" ? "job" : row.purpose === "hold" ? "hold" : "needs",
                      }}
                      current={row.id === "job"}
                    />
                  ))}
                </ul>
              </div>
            }
            thread={
              <div className="space-y-6 p-4 sm:p-6">
                <div className="min-w-0">
                  <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-tight text-ink">
                    Otieno
                  </h2>
                  <p className="mt-2 text-sm text-ink-soft">12 Sep 2026, 08:10</p>
                  <p className="mt-1 min-w-0 break-all font-mono text-sm text-ink">254700000002</p>
                </div>
                <section className="min-w-0 rounded-2xl border border-line bg-surface p-5">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">Summary</h2>
                  <CallSummaryCard
                    name="Otieno"
                    callerNumber="254700000002"
                    want="House cleaning tomorrow 9am"
                    done="Visit saved"
                    mood="calm"
                    next="Confirm the visit"
                  />
                </section>
                <div className="mx-auto flex w-full max-w-lg flex-col items-stretch gap-2">
                  <div className="text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Do next</p>
                    <p className="mt-1 text-base font-semibold leading-snug text-ink">Confirm the visit</p>
                  </div>
                  <InboxJobActions id="job-1" status="requested" extra />
                  <WhatsAppLink
                    number="254700000002"
                    variant="ghost"
                    label="Reply on WhatsApp"
                    className="w-full"
                  />
                  <CallerNoteComposer
                    callId="call-1"
                    callerPhone="254700000002"
                    callerName="Otieno"
                    callerSmsOn
                    collapsed
                  />
                </div>
                <CallTranscript turns={TURNS} />
                <div className="space-y-4 border-t border-line/80 pt-4 text-sm text-ink-soft">
                  <p>Duration: 48s</p>
                  <p>Assist: Handled</p>
                </div>
              </div>
            }
          />
        </main>
        <DeskTabBar />
      </div>
    </div>
  );
}
