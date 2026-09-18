import { InboxSplit } from "@/components/InboxSplit";

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
  return <InboxSplit list={inbox} thread={children} />;
}
