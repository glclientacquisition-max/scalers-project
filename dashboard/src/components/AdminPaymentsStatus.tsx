import { ListRow } from "@/components/ui/ListRow";
import type { BachsStatusView } from "@/lib/adminPayCopy";

/** Read-only Bachs status. Values are yes/no. Secrets never reach this screen. */
export function AdminPaymentsStatus({ status }: { status: BachsStatusView }) {
  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Bachs</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow title="Mode" preview={status.modeLabel} />
          <ListRow title="Live switch" preview={status.liveSwitch} />
          <ListRow title="Key" preview={status.keySet} />
          <ListRow title="Webhook secret" preview={status.webhookSecretSet} />
        </ul>
      </section>
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Live businesses</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow title="Allowed" preview={status.liveSummary} />
          {status.liveNames.map((name) => (
            <ListRow key={name} title={name} preview="Live payments on" />
          ))}
        </ul>
      </section>
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Webhooks</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow title="Last received" preview={status.lastWebhook} />
          <ListRow title="Last 24 hours" preview={status.webhooks24h} />
        </ul>
      </section>
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Reconcile</h2>
        {status.reconcileAvailable ? (
          status.reconcile.length === 0 ? (
            <p className="px-4 py-3 text-body text-ink-2">No mismatches.</p>
          ) : (
            <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
              {status.reconcile.map((row) => (
                <ListRow key={row.label} title={row.label} preview={String(row.count)} />
              ))}
            </ul>
          )
        ) : (
          <p className="px-4 py-3 text-body text-ink-2">Not on this database.</p>
        )}
      </section>
    </div>
  );
}
