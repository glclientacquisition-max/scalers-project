import { notFound } from "next/navigation";
import { DeskPhoneHeader, DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";

/**
 * Local chrome harness (no desk login). DASHBOARD_OPEN=true only.
 */
export default function DevDeskShellPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      <DeskRail needsCount={3} homeHref="/dev/desk-shell" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <DeskPhoneHeader homeHref="/dev/desk-shell" />
        <main className={deskMainClass}>
          <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">Desk shell</h1>
          <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface">
            {["Amina · Confirm visit", "Otieno · Pickup", "Wanjiku · Human asked", "Last row must clear the tab bar"].map(
              (row) => (
                <li key={row} className="px-4 py-3.5 text-sm text-ink">
                  {row}
                </li>
              ),
            )}
          </ul>
        </main>
        <DeskTabBar needsCount={3} />
      </div>
    </div>
  );
}
