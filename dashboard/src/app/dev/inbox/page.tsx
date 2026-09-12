import { notFound } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { DeskNav, DeskTabBar } from "@/components/DeskNav";
import { InboxPhoneRow } from "@/components/InboxItemRow";
import type { InboxItem } from "@/lib/inboxPurpose";

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
];

export default function DevInboxPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className="min-h-screen min-w-0">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-desk items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <BrandLockup href="/dev/inbox" name="Scalers" size="sm" priority className="max-w-full" />
          <DeskNav />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-desk px-4 pt-6 pb-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:pt-10 md:pb-10">
        <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-tight text-ink">
          Inbox
        </h1>
        <p className="mt-1 text-[13px] text-ink-soft">3 need you</p>
        <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
          {ROWS.map((row) => (
            <InboxPhoneRow
              key={row.id}
              item={row}
              businessName="Workspace"
              purpose={row.purpose === "job" ? "job" : row.purpose === "hold" ? "hold" : "needs"}
            />
          ))}
        </ul>
      </main>
      <DeskTabBar />
    </div>
  );
}
