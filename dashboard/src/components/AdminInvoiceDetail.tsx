import Link from "next/link";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import type { AdminInvoiceDetail as Detail, AdminInvoiceEvent } from "@/lib/adminPayCopy";

function Block({ title, label, rows }: { title: string; label: string; rows: AdminInvoiceEvent[] | { id: string; title: string; preview: string }[] }) {
  return (
    <section className="space-y-1">
      <h2 className="px-4 text-caption text-ink-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-ops-body text-ink-2">None.</p>
      ) : (
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70" aria-label={label}>
          {rows.map((row) => (
            <ListRow
              key={row.id}
              title={row.title}
              preview={"preview" in row ? row.preview : undefined}
              when={"when" in row ? row.when : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminInvoiceDetail({ invoice }: { invoice: Detail }) {
  return (
    <div className="space-y-8">
      <div className="space-y-2 px-4">
        <p className="text-ops-body text-ink-2">{invoice.businessName}</p>
        <Stamp tone={invoice.tone}>{invoice.statusLabel}</Stamp>
        <p className="text-ops-body tabular-nums text-ink">
          {invoice.total} · paid {invoice.paid} · {invoice.due}
        </p>
        <p className="text-meta text-ink-3">Created {invoice.created}</p>
        <Link
          href={`/admin/businesses/${invoice.businessId}?money=1`}
          className="inline-flex min-h-ops-touch md:min-h-ops-row items-center text-ops-body font-medium text-accent"
        >
          Shop money
        </Link>
      </div>
      {invoice.warning ? (
        <p className="px-4 text-ops-body text-attention" role="alert">
          {invoice.warning}
        </p>
      ) : null}
      <Block title="Lines" label="Invoice lines" rows={invoice.lines} />
      <Block title="Payments" label="Payments" rows={invoice.payments} />
      <Block title="Checkouts" label="Checkout attempts" rows={invoice.attempts} />
      <Block title="Receipts" label="Receipts" rows={invoice.receipts} />
      <Block title="Audit" label="Audit trail" rows={invoice.audit} />
      {invoice.lines.length + invoice.payments.length + invoice.attempts.length + invoice.receipts.length + invoice.audit.length === 0 ? (
        <Empty title="Nothing else on this invoice." line="Lines, payments, checkouts, receipts, and audit show here." />
      ) : null}
    </div>
  );
}
