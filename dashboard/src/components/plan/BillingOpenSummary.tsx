import { Stamp } from "@/components/ui/Stamp";
import { formatKsh } from "@/lib/planPricing";

function invoiceOverdue(dueAt: string | null, status: string, now = Date.now()): boolean {
  if (status !== "open") return false;
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  return Number.isFinite(due) && due < now;
}

export function BillingOpenSummary({
  periodEndLabel,
  invoices,
}: {
  periodEndLabel: string | null;
  invoices: Array<{ status: string; totalKes: number; dueAt: string | null }>;
}) {
  const open = invoices.filter((inv) => inv.status === "open");
  if (!periodEndLabel && open.length === 0) return null;

  const openTotal = open.reduce((sum, inv) => sum + Math.max(0, inv.totalKes), 0);
  const overdueCount = open.filter((inv) => invoiceOverdue(inv.dueAt, inv.status)).length;

  return (
    <div className="rounded-2xl border border-hairline bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {periodEndLabel ? (
            <p className="text-body text-ink">
              Usage period ends <span className="font-medium">{periodEndLabel}</span>
            </p>
          ) : (
            <p className="text-body text-ink">Billing</p>
          )}
          {open.length > 0 ? (
            <p className="mt-1 text-meta text-ink-2 tabular-nums">
              {open.length} open · {formatKsh(openTotal)} due
            </p>
          ) : (
            <p className="mt-1 text-meta text-ink-2">No open invoices</p>
          )}
        </div>
        {overdueCount > 0 ? <Stamp tone="attention">Overdue</Stamp> : null}
      </div>
    </div>
  );
}
