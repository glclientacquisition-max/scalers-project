import { notFound } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { DeskNav, DeskTabBar } from "@/components/DeskNav";
import { InboxPrototype } from "@/components/inboxPrototype/InboxPrototype";

function inboxPrototypeOpen(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.DASHBOARD_OPEN === "true"
  );
}

/** Visual Inbox bench. Does not replace /calls. */
export default function DevInboxPage() {
  if (!inboxPrototypeOpen()) {
    notFound();
  }

  return (
    <div className="desk-theme min-h-screen min-w-0">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-desk items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <BrandLockup href="/dev/inbox" name="Scalers" size="sm" priority className="max-w-full" />
          <DeskNav />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-desk px-4 pt-6 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-10">
        <InboxPrototype />
      </main>
      <DeskTabBar />
    </div>
  );
}
