import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export type OwnerInvoiceListItem = {
  id: string;
  number: string;
  totalLabel: string;
  statusLabel: string;
  payHref?: string | null;
  payLabel?: string | null;
};

export function OwnerInvoiceList({ invoices }: { invoices: OwnerInvoiceListItem[] }) {
  if (invoices.length === 0) {
    return <Empty title="No invoices" line="They show here when one is issued." />;
  }
  return (
    <ul className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="border-b border-hairline px-4 py-3 last:border-b-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-ink">{invoice.number}</p>
              <p className="mt-0.5 text-meta text-ink-2">{invoice.statusLabel}</p>
            </div>
            <p className="shrink-0 text-body tabular-nums text-ink">{invoice.totalLabel}</p>
          </div>
          {invoice.payHref && invoice.payLabel ? (
            <div className="mt-3">
              <ButtonLink href={invoice.payHref} variant="tonal" size="sm">
                {invoice.payLabel}
              </ButtonLink>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
