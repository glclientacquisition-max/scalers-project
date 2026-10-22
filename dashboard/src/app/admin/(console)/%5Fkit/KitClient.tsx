"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, KpiTile, Money, OpsConfirm, OpsSkeleton, PageHeader, StatusPill, type ConfirmStrength, type OpsTone } from "@/components/ops";

const TONES: [OpsTone, string][] = [["ok", "Live"], ["info", "Scheduled"], ["warn", "Low balance"], ["danger", "Failed"], ["neutral", "Archived"], ["beta", "Beta"]];
const SAMPLE = [0, 1250, -1200, 20000, 1000000];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-ops-2">
      <h2 className="text-ops-heading text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function KitClient() {
  const [open, setOpen] = useState<ConfirmStrength | null>(null);
  return (
    <div className="ops-theme mx-auto flex w-full max-w-[1600px] flex-col gap-ops-5 px-ops-4 py-ops-4 md:px-ops-5">
      <PageHeader title="Ops kit" count={9} actions={<StatusPill tone="info">Staging</StatusPill>} />

      <Section title="Status">
        <div className="flex flex-wrap gap-ops-2">{TONES.map(([t, w]) => <StatusPill key={t} tone={t}>{w}</StatusPill>)}</div>
      </Section>

      <Section title="Money">
        <ul className="divide-y divide-hairline rounded-lg bg-surface">
          {SAMPLE.map((v) => (
            <li key={v} className="flex h-ops-touch items-center justify-between px-ops-3 md:h-ops-row">
              <span className="text-ops-label text-ink-2">Exact / compact</span>
              <span className="flex gap-ops-4"><Money value={v} /><Money value={v} compact className="text-ink-2" /></span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="KPI tiles">
        <div className="grid grid-cols-2 gap-ops-2 lg:grid-cols-4">
          <KpiTile label="Collected this month" value={<Money value={184500} compact />} delta={4.2} trend={[3, 4, 4, 6, 5, 7, 8]} />
          <KpiTile label="Calls today" value="312" delta={-12} trend={[9, 8, 8, 6, 7, 5, 4]} />
          <KpiTile label="Live businesses" value="27" />
          <KpiTile label="Unpaid invoices" value={<Money value={0} />} delta={0} />
        </div>
      </Section>

      <Section title="Loading">
        <div className="grid grid-cols-2 gap-ops-2 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg bg-surface p-ops-3">
              <OpsSkeleton className="h-3 w-2/3" /><OpsSkeleton className="h-7 w-1/2" /><OpsSkeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Empty and error">
        <EmptyState title="No unpaid invoices. New ones show here on the 1st." />
        <ErrorState title="Couldn't load invoices." onRetry={() => undefined} />
      </Section>

      <Section title="Confirm (bottom sheet on phones, side drawer from md)">
        <div className="flex flex-wrap gap-ops-2">
          <Button variant="tonal" size="sm" onClick={() => setOpen("light")}>Light</Button>
          <Button variant="tonal" size="sm" onClick={() => setOpen("money")}>Money</Button>
          <Button variant="tonal" size="sm" onClick={() => setOpen("destructive")}>Destructive</Button>
        </div>
      </Section>

      <OpsConfirm open={open === "light"} strength="light" title="Move to Growth?" confirmLabel="Move" onClose={() => setOpen(null)} onConfirm={() => setOpen(null)}>
        Jirani Cleaning moves to Growth at the end of this period.
      </OpsConfirm>
      <OpsConfirm open={open === "money"} strength="money" amount={1500} title="Grant minutes?" confirmLabel="Grant" onClose={() => setOpen(null)} onConfirm={() => setOpen(null)}>
        Adds 30 minutes to Jirani Cleaning for this period.
      </OpsConfirm>
      <OpsConfirm open={open === "destructive"} strength="destructive" typeToConfirm="REMOVE" title="Remove package now?" confirmLabel="Remove" onClose={() => setOpen(null)} onConfirm={() => setOpen(null)}>
        Jirani Cleaning loses its included minutes today. This can&apos;t be undone.
      </OpsConfirm>
    </div>
  );
}
