"use client";

import { usePathname } from "next/navigation";

function onCallRecord(pathname: string) {
  return /^\/calls\/[^/]+$/.test(pathname);
}

/** List column. Full width on phone `/calls`. Hidden on a phone call. Always on `md+`. */
export function InboxColumn({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onCall = onCallRecord(pathname);

  return (
    <aside
      aria-label="Inbox"
      className={
        onCall
          ? "hidden min-w-0 md:flex md:h-full md:w-[22rem] md:shrink-0 md:flex-col md:overflow-hidden md:border-r md:border-line/80 lg:w-[24rem]"
          : "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:h-full md:w-[22rem] md:flex-none md:border-r md:border-line/80 lg:w-[24rem]"
      }
    >
      {children}
    </aside>
  );
}

/** Thread pane. Hidden on phone when Inbox is the list. Empty canvas on `md+` `/calls`. */
export function InboxThread({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const listOnly = !onCallRecord(pathname);

  return (
    <div
      className={
        listOnly
          ? "hidden min-w-0 flex-1 md:block md:min-h-0 md:overflow-x-hidden md:overflow-y-auto"
          : "min-w-0 flex-1 md:min-h-0 md:overflow-x-hidden md:overflow-y-auto"
      }
    >
      {children}
    </div>
  );
}
