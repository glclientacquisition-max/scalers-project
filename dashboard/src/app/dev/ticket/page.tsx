import { Suspense } from "react";
import { notFound } from "next/navigation";
import { InboxTicketView } from "@/components/InboxTicketView";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import type { TranscriptRow } from "@/lib/supabase";

/**
 * Open ticket harness (no desk login). DASHBOARD_OPEN=true only.
 * Phone tabs stay hidden. Back returns to Overview.
 */
const TURNS: TranscriptRow[] = Array.from({ length: 12 }, (_, index) => ({
  id: `t-${index}`,
  created_at: "2026-09-12T05:10:00.000Z",
  call_id: "call-1",
  speaker: index % 2 === 0 ? "caller" : "agent",
  text_content: index % 2 === 0 ? "Can you confirm the visit tomorrow morning?" : "Visit saved for tomorrow 9am.",
  latency_ms: index % 2 === 0 ? null : 380,
}));

export default function DevTicketPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={1} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <InboxTicketView
            callId="call-1"
            backHref="/dev/home"
            contactHref="/dev/contacts/file"
            callerName="Otieno"
            lastContactAt="2026-09-12T05:10:00.000Z"
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
            recordingUrl={null}
            durationLabel="48s"
            assistLabel="Handled"
            assistNote={null}
            escalatedLine={null}
            escalationDelivery={null}
            liveConnectLine={null}
            escalatePeople={[]}
            archived={false}
            leadStatus="new"
            businessName="Workspace"
          />
        </main>
        <DeskTabBar needsCount={1} />
      </div>
    </div>
  );
}
