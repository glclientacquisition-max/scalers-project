import { notFound } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { DeskNav, DeskTabBar } from "@/components/DeskNav";

/**
 * Local chrome harness (no desk login). DASHBOARD_OPEN=true only.
 */
export default function DevDeskShellPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className="min-h-screen min-w-0">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-desk items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <BrandLockup href="/dev/desk-shell" name="Scalers" size="sm" priority className="max-w-full" />
          <DeskNav />
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-desk px-4 pt-6 pb-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:pt-10 md:pb-10">
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
  );
}
