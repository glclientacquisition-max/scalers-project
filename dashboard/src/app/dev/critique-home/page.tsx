import { notFound } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { HomeGetReadyCallsCard } from "@/components/HomeGetReadyCallsCard";
import { HomeUsageSection } from "@/components/HomeUsageSection";
import { CallInsights } from "@/components/insights/CallInsights";
import type { CallInsights as Insights } from "@/lib/callInsights";

/**
 * Overview aside, Get ready card and What callers told us with fixture data. DASHBOARD_OPEN=true only.
 * A beta business at 0 of 300 minutes with payment details saved but not confirmed.
 */
const insights: Insights = {
  days: 30,
  calls: 41,
  ready: true,
  sections: [
    { id: "lost", title: "Why sales were lost", summary: "Outside our area: 8 of 10", basis: 10, thin: "", bars: [] },
    { id: "products", title: "Most asked about", summary: "Carpet cleaning, in 37 calls", basis: 37, thin: "", bars: [] },
    { id: "objections", title: "Price pushback", summary: null, basis: 0, thin: "No caller has pushed back on price yet.", bars: [] },
    { id: "unanswered", title: "Questions we could not answer", summary: "43 questions to add to your FAQs", basis: 43, thin: "", bars: [] },
    { id: "busiest", title: "Busiest times", summary: "10am to 11am, Wednesdays", basis: 41, thin: "", bars: [] },
    { id: "language", title: "Languages callers use", summary: "Mixed 64%, English 27%, Kiswahili 9%", basis: 41, thin: "", bars: [] },
  ],
};

export default async function DevCritiqueHomePage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={3} homeHref="/dev/critique-home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
            <div className="min-w-0 space-y-6 lg:col-span-7">
              <HomeGetReadyCallsCard
                canEdit
                items={[
                  { id: "name", label: "Business name", href: "/settings?tab=train&panel=identity", complete: true },
                  { id: "catalog", label: "Catalogue and prices", href: "/settings/knowledge", complete: true },
                  { id: "hours", label: "Opening hours", href: "/settings?tab=train&panel=hours", complete: true },
                  {
                    id: "payment",
                    label: "Payment details",
                    href: "/settings?tab=train&panel=policies",
                    complete: false,
                    reason: "Payment details are saved but not confirmed. Open Policies and save.",
                  },
                ]}
              />
              <CallInsights insights={insights} />
            </div>
            <aside className="min-w-0 lg:col-span-5" aria-label="Today">
              <div className="overflow-hidden rounded-2xl border border-hairline bg-surface" data-home-usage-fixture="">
                <p className="px-4 py-4 text-body text-ink">Calls today</p>
                <HomeUsageSection
                  minutesLeft={0}
                  packLabel="Starter · Free during beta"
                  minuteStatus={null}
                  lowNotice="0 of 300 minutes left until 31 Oct."
                  lowNoticeNote="During beta nothing is charged and calls keep working."
                  showLink
                  isBeta
                />
              </div>
            </aside>
          </div>
        </main>
        <DeskTabBar needsCount={3} />
      </div>
    </div>
  );
}
