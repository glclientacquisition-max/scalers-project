import { notFound } from "next/navigation";
import { StatusMark } from "@/components/ui/StatusMark";
import { Stamp } from "@/components/ui/Stamp";
import { Empty } from "@/components/ui/Empty";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button, ButtonLink } from "@/components/ui/Button";
import { HealthStrip } from "@/components/admin/v2/HealthStrip";
import { MinutesMeter } from "@/components/ui/MinutesMeter";
import { TodayCalls } from "@/components/home/TodayCalls";
import { KpiTile } from "@/components/ops";
import "@/styles/ops.css";

/**
 * Status vocabulary at 360. Words only: no sample counts.
 * DASHBOARD_OPEN=true only.
 */
export default function VisualStatusPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <main className="mx-auto flex w-full max-w-[360px] flex-col gap-4 bg-canvas px-4 py-6 text-ink">
      <h1 className="text-page">Needs attention</h1>
      <HealthStrip signals={null} />
      <section className="rounded-2xl border border-hairline bg-surface px-4 py-4" aria-label="Businesses">
        <h2 className="text-title">Businesses</h2>
        <p className="mt-2 text-body text-ink-2">No business matches.</p>
        <p className="mt-1 text-meta text-attention">Could not load usage.</p>
      </section>
      <div className="ops-theme grid grid-cols-2 gap-2">
        <KpiTile label="Collected" period="This month" state="empty" emptyTitle="No payments this month." href="/admin/billing/payments" />
        <KpiTile label="Billed" period="This month" state="error" errorTitle="Could not load billed." />
      </div>
      <TodayCalls lineLive split={{ answered: 0, handed: 0, hung: 0, other: 0 }} rows={[]} truncated={false} />
      <section className="rounded-2xl border border-hairline bg-surface px-4 py-4" aria-label="Minutes">
        <h2 className="text-title">Minutes</h2>
        <div className="mt-2">
          <MinutesMeter
            shape="ring"
            input={{ included: 0, used: 0, left: 0, underOne: false, mode: "none", overLabel: null }}
          />
        </div>
      </section>
      <h2 className="text-title">Line</h2>
      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface" aria-label="Line">
        <div className="px-4 py-4">
          <StatusMark tone="neutral" icon="clock">Number pending</StatusMark>
          <p className="mt-2 text-body text-ink-2">Your number is not live yet.</p>
        </div>
        <div className="border-t border-hairline px-4 py-3">
          <p className="text-body text-ink-2">Calls today</p>
          <p className="mt-1 text-meta text-ink-2">Not loaded on this page.</p>
        </div>
        <div className="border-t border-hairline px-4 py-4">
          <ButtonLink href="/settings" className="w-full">Train</ButtonLink>
        </div>
      </section>
      <section className="flex flex-wrap gap-2" aria-label="Pills">
        <StatusMark tone="ok">Live</StatusMark>
        <StatusMark tone="neutral" icon="clock">Number pending</StatusMark>
        <StatusMark tone="warn">Needs training</StatusMark>
        <StatusMark tone="danger">Down</StatusMark>
        <StatusMark tone="info">Beta</StatusMark>
        <StatusMark tone="neutral">Archived</StatusMark>
        <Stamp tone="attention">Low</Stamp>
        <Stamp tone="ok">Done</Stamp>
      </section>
      <section className="rounded-2xl border border-hairline bg-surface" aria-busy="true" aria-label="Loading">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>
      </section>
      <section className="rounded-2xl border border-hairline bg-surface">
        <Empty title="No status yet" line="It shows when the line has a number." />
      </section>
      <section role="alert" className="rounded-2xl bg-attention-tonal px-4 py-3">
        <p className="text-body text-attention">Could not load status.</p>
        <Button variant="tonal" size="sm" className="mt-3">Retry</Button>
      </section>
    </main>
  );
}
