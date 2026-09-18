"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";

function onCallRecord(pathname: string) {
  return /^\/calls\/[^/]+$/.test(pathname);
}

const LIST_WIDTH =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:h-full md:flex-none md:border-r md:border-line/80";
const LIST_WIDTH_ON_CALL =
  "hidden min-w-0 md:flex md:h-full md:shrink-0 md:flex-col md:overflow-hidden md:border-r md:border-line/80";
const LIST_DEFAULT = "md:w-[20rem] lg:w-[24rem] xl:w-[28rem]";
const LIST_CUSTOM = "md:w-[var(--inbox-list-w)]";

/** List column. Full width on phone `/calls`. Hidden on a phone call. Always on `md+`. */
export function InboxColumn({
  children,
  width,
}: {
  children: ReactNode;
  width?: number | null;
}) {
  const pathname = usePathname();
  const onCall = onCallRecord(pathname);
  const custom = typeof width === "number";

  return (
    <aside
      aria-label="Inbox"
      style={custom ? ({ "--inbox-list-w": `${width}px` } as CSSProperties) : undefined}
      className={[onCall ? LIST_WIDTH_ON_CALL : LIST_WIDTH, custom ? LIST_CUSTOM : LIST_DEFAULT].join(
        " "
      )}
    >
      {children}
    </aside>
  );
}

/** Thread pane. Hidden on phone when Inbox is the list. Empty canvas on `md+` `/calls`. */
export function InboxThread({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const listOnly = !onCallRecord(pathname);

  return (
    <div
      className={
        listOnly
          ? "hidden min-w-0 flex-1 md:block md:min-h-0 md:min-w-[20rem] md:overflow-x-hidden md:overflow-y-auto"
          : "min-w-0 flex-1 md:min-h-0 md:min-w-[20rem] md:overflow-x-hidden md:overflow-y-auto"
      }
    >
      {children}
    </div>
  );
}
