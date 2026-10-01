import { notFound } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskRecovery } from "@/components/ui/DeskRecovery";

type DevNotFoundProps = {
  searchParams: Promise<{ state?: string }>;
};

/**
 * Local 404 harness (no desk login). DASHBOARD_OPEN=true only.
 * Same DeskRecovery block as `(desk)/not-found.tsx`, inside a static shell.
 */
export default async function DevNotFoundPage({ searchParams }: DevNotFoundProps) {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  const { state } = await searchParams;
  const missingCall = state === "call";

  return (
    <div className={deskShellClass}>
      <DeskRail homeHref="/dev/not-found" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          {missingCall ? (
            <DeskRecovery
              title="This call is not in the inbox."
              href="/calls"
              action="Inbox"
            />
          ) : (
            <DeskRecovery
              title="Page not found"
              line="That address is not a Scalers page."
              href="/home"
              action="Overview"
            />
          )}
        </main>
        <DeskTabBar />
      </div>
    </div>
  );
}
