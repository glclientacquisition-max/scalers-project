import { notFound } from "next/navigation";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";
import { ThemePicker } from "@/components/ThemePicker";

/**
 * Local Overview identity harness (no desk login). DASHBOARD_OPEN=true only.
 */
export default function DevHomePage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      <DeskRail needsCount={3} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main className={deskMainClass}>
          <HomeOverviewHeader
            business="Chapter One Dental and Wellness Studio Nairobi"
            today={{ iso: "2026-09-20", label: "Sunday 20 September" }}
          />
          <section className="mt-6 min-w-0" aria-labelledby="work-heading">
            <h2 id="work-heading" className="font-display text-xl tracking-tight text-ink">
              Work
            </h2>
            <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
              {["Return calls", "Holds", "Visits"].map((row, index) => (
                <li
                  key={row}
                  className={[
                    "flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium text-ink lg:min-h-11",
                    index === 0 ? undefined : "border-t border-line",
                  ].join(" ")}
                >
                  {row}
                </li>
              ))}
            </ul>
          </section>
          <div className="mt-6 max-w-lg">
            <ThemePicker />
          </div>
        </main>
        <DeskTabBar needsCount={3} />
      </div>
    </div>
  );
}
