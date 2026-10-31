import { notFound } from "next/navigation";
import { StatusMark } from "@/components/ui/StatusMark";
import { Stamp } from "@/components/ui/Stamp";
import { Empty } from "@/components/ui/Empty";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";

/**
 * Status vocabulary at 360. Words only: no sample counts.
 * DASHBOARD_OPEN=true only.
 */
export default function VisualStatusPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <main className="mx-auto flex w-full max-w-[360px] flex-col gap-4 bg-canvas px-4 py-6 text-ink">
      <h1 className="text-page">Status</h1>
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
