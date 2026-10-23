"use client";

import type { BachsStatusView } from "@/lib/adminPayCopy";
import { PageHeader, UnlockCta } from "@/components/ops";
import "@/styles/ops.css";

type Row = { label: string; value: string; note?: string };

function Card({ title, meta, rows }: { title: string; meta?: string; rows: Row[] }) {
  return (
    <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-ops-4 gap-y-1 border-b border-hairline px-ops-3 py-ops-2">
        <h2 className="font-semibold text-ink">{title}</h2>
        {meta ? <p className="text-ops-label text-ink-2">{meta}</p> : null}
      </header>
      <dl>
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-1 gap-0.5 border-b border-hairline px-ops-3 py-ops-2 last:border-b-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-ops-4">
            <dt className="text-ink-2">{r.label}</dt>
            <dd className="min-w-0">
              <span className="font-semibold tabular-nums text-ink">{r.value}</span>
              {r.note ? <span className="ms-2 text-ops-label text-ink-2">{r.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function onOff(v: boolean): string {
  return v ? "On" : "Off";
}

/**
 * Payments (ADMIN_V2): ops status cards as definition rows. View-only.
 * Definition rows only. Unlock opens an honest note — step-up is next.
 */
export function AdminPaymentsV2({ status }: { status: BachsStatusView }) {
  const flags = status.dbFlags;
  const ready = status.runtimeControlsAvailable;
  const absent = "Not on this environment";

  const settings: Row[] = [
    {
      label: "Package editor",
      value: flags.available ? onOff(flags.packageEditorEnabled) : absent,
      note: flags.available ? "Staff can draft and publish packages when On." : undefined,
    },
    {
      label: "Signup trial",
      value: !flags.available
        ? absent
        : !flags.packageEditorEnabled
          ? "Off · package editor is off"
          : onOff(flags.signupTrialEnabled),
      note: "New businesses start on a trial when On.",
    },
  ];

  const checkout: Row[] = [
    { label: "Payments mode", value: ready ? status.modeLabel : absent },
    {
      label: "All live payments",
      value: ready ? onOff(status.hosting.liveMasterOn) : absent,
      note: "Live checkout for allowed businesses.",
    },
    {
      label: "Billing notices",
      value: ready ? onOff(status.hosting.noticesOn) : absent,
      note: "Owners get billing messages when On.",
    },
    {
      label: "Owner plan changes",
      value: ready ? onOff(status.hosting.planChangeOn) : absent,
      note: "Owners can switch plan from the desk when On.",
    },
  ];

  const keys: Row[] = [
    { label: "API key", value: status.keySet },
    { label: "Webhook secret", value: status.webhookSecretSet },
  ];

  const live: Row[] = [
    { label: "Summary", value: status.liveSummary },
    ...status.liveRows.map((r) => ({ label: r.name, value: r.preview })),
  ];

  const webhooks: Row[] = [
    { label: "Last received", value: status.lastWebhook },
    { label: "Last 24 hours", value: status.webhooks24h },
  ];

  const reconcile: Row[] = status.reconcileAvailable
    ? status.reconcile.length
      ? status.reconcile.map((r) => ({ label: r.label, value: String(r.count) }))
      : [{ label: "Mismatches", value: "None" }]
    : [{ label: "Reconcile", value: absent }];

  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3 pe-ops-4 text-ops-body">
      <PageHeader
        title="Payments"
        actions={
          <UnlockCta
            site="payments"
            action="payments:flags"
            what="change payment and checkout flags"
            observedHint="Flag edits land with the Payments remake. Observe only logged the gate."
          />
        }
      />
      <Card title="Settings" meta="View only · unlock to change" rows={settings} />
      <Card title="Checkout" meta={ready ? "runtime controls" : "not on this environment"} rows={checkout} />
      <Card title="Keys" meta="set or not — values stay in hosting" rows={keys} />
      <Card title="Live businesses" rows={live} />
      <Card title="Webhooks" rows={webhooks} />
      <Card title="Reconcile" rows={reconcile} />
    </div>
  );
}
