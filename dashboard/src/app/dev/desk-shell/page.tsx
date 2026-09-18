import { notFound } from "next/navigation";
import { DeskPhoneHeader, DeskRail, DeskTabBar } from "@/components/DeskNav";

/**
 * Local chrome harness (no desk login). DASHBOARD_OPEN=true only.
 */
export default function DevDeskShellPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className="flex min-h-screen min-w-0">
      <DeskRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <DeskPhoneHeader />
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[var(--desk-tabbar-clearance)] sm:px-6 md:p-6">
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
        <DeskTabBar />
      </div>
    </div>
  );
}
