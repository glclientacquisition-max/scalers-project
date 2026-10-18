import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { LinePausedBanner } from "@/components/LinePausedBanner";
import { btnGhost } from "@/components/ui/deskChrome";
import { LINE_PAUSED_SEND_ERROR } from "@/lib/tenantLineState";

/**
 * Desk while a Super Admin has paused the line: banner on every page, reads work, a send
 * attempt shows the plain blocked text. /dev/line-paused/blocked shows the result after pressing Send SMS.
 */
export function LinePausedFixture({ blocked }: { blocked: boolean }) {
  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={1} homeHref="/dev/line-paused" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <LinePausedBanner />
        <main className={deskMainClass}>
          <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">Calls</h1>
          <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface">
            {["Amina Wanjiru · Confirm visit · 10:42", "Otieno · Pickup tomorrow · 09:15", "Grace · Price for braids · Yesterday"].map(
              (row) => (
                <li key={row} className="px-4 py-3.5 text-sm text-ink">
                  {row}
                </li>
              ),
            )}
          </ul>
          <section className="mt-6 space-y-2 rounded-2xl border border-line bg-surface p-4">
            <p className="text-meta font-medium text-ink-2">SMS to Amina Wanjiru</p>
            <p className="rounded-lg border border-hairline bg-surface px-2.5 py-2 text-body text-ink">
              Hi Amina, we can do Tuesday 2pm instead. See you then.
            </p>
            <button type="button" className={`${btnGhost} w-full`}>
              Send SMS
            </button>
            {blocked ? <p className="text-body text-warn">{LINE_PAUSED_SEND_ERROR}</p> : null}
          </section>
        </main>
        <DeskTabBar needsCount={1} />
      </div>
    </div>
  );
}
