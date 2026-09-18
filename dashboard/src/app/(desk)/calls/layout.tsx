import { InboxColumn, InboxThread } from "@/components/InboxColumn";

/**
 * Inbox list is a parallel `@inbox` slot. Always the middle column on md+.
 * Phone `/calls` uses that slot full width. Phone `/calls/[id]` hides it.
 */
export default function CallsLayout({
  children,
  inbox,
}: {
  children: React.ReactNode;
  inbox: React.ReactNode;
}) {
  return (
    <div
      data-desk-bleed
      className="flex min-h-0 flex-1 flex-col md:h-full md:flex-row md:items-stretch md:overflow-hidden"
    >
      <InboxColumn>{inbox}</InboxColumn>
      <InboxThread>{children}</InboxThread>
    </div>
  );
}
