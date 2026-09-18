/**
 * Inbox list is a parallel slot (`@inbox`), not nested inside the call page.
 * `/calls` has no slot content. `/calls/[id]` shows the list on `md+`.
 */
export default function CallsLayout({
  children,
  inbox,
}: {
  children: React.ReactNode;
  inbox: React.ReactNode;
}) {
  return (
    <div className="md:flex md:items-stretch md:gap-6 md:[&:has(aside:not(:empty))]:h-[calc(100dvh-var(--desk-header-h)-5rem)] md:[&:has(aside:not(:empty))]:overflow-hidden">
      <aside
        aria-label="Inbox"
        className="hidden min-w-0 md:flex md:h-full md:w-[22rem] md:shrink-0 md:flex-col md:overflow-hidden md:empty:hidden lg:w-[24rem]"
      >
        {inbox}
      </aside>
      <div className="min-w-0 flex-1 md:min-h-0 md:overflow-x-hidden md:overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
