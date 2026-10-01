import type { ReactNode } from "react";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";

/** Static desk chrome for the local 404 harness. No session. */
export function DevNotFoundFrame({ children }: { children: ReactNode }) {
  return (
    <div className={deskShellClass}>
      <DeskRail homeHref="/dev/not-found" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          {children}
        </main>
        <DeskTabBar />
      </div>
    </div>
  );
}
