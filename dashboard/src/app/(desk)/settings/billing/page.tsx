import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { Empty } from "@/components/ui/Empty";
import { PageHeader } from "@/components/ui/PageHeader";
import { BillingNote } from "@/components/DeskBillingBanner";
import { NoticeList } from "@/components/plan/NoticeList";
import { PaymentCheck } from "@/components/plan/PaymentCheck";
import { nairobiDay } from "@/lib/billingBanner";
import { invoicePayState } from "@/lib/invoicePayState";
import { formatKsh } from "@/lib/planPricing";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan, type OwnerInvoiceRow } from "@/lib/ownerPlanLoad";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-desk-nested="" className="mx-auto w-full max-w-lg px-4 py-4">
      <PageHeader title="Billing" back={{ href: "/settings", label: "Settings" }} />
      {children}
    </div>
  );
}

function periodLabel(invoice: OwnerInvoiceRow): string {
  const start = nairobiDay(invoice.periodStart);
  const end = nairobiDay(invoice.periodEnd);
  if (start && end) return `${start} to ${end}`;
  return start || end || "";
}

async function BillingBody({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const fromPay = (await searchParams).from === "pay";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const loaded = await loadOwnerPlan(tenant.id);
  if (!loaded.ok) return <DeskLoadError>Could not load Billing.</DeskLoadError>;
  const model = loaded.model;
  if (model.freeBeta || !model.surface.showInvoices) {
    return (
      <Frame>
        <h2 className="mt-6 text-title text-ink">Free during beta</h2>
        <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
      </Frame>
    );
  }

  const checking = fromPay && model.invoices.some((invoice) => invoice.status === "open");

  return (
    <Frame>
      {model.surface.showDunningBanner && model.banner ? <BillingNote banner={model.banner} /> : null}
      <div className="mt-4">
        <PaymentCheck active={checking} />
      </div>
      {model.invoices.length === 0 ? (
        <Empty title="No invoices" line="They show here when one is issued." />
      ) : (
        <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
          {model.invoices.map((invoice) => {
            const pay = invoicePayState({
              status: invoice.status,
              payToken: model.surface.showPayLinks ? invoice.payToken : null,
              returnedFromPay: fromPay && invoice.status === "open",
            });
            if (pay.hidden) return null;
            const due = nairobiDay(invoice.dueAt);
            return (
              <li key={invoice.id} className="px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 flex-1 truncate text-body text-ink">{invoice.number}</p>
                  <p className="shrink-0 text-body tabular-nums text-ink">{formatKsh(invoice.totalKes)}</p>
                </div>
                <p className="mt-0.5 text-meta text-ink-2">
                  {[periodLabel(invoice), due ? `Due ${due}` : "", "incl. VAT"].filter(Boolean).join(" · ")}
                </p>
                {pay.label === "Paid" || pay.label === "Checking payment" ? (
                  <p className="mt-1 text-meta text-ink">{pay.label}</p>
                ) : null}
                {pay.note ? <p className="mt-1 text-meta text-ink-2">{pay.note}</p> : null}
                {pay.showPayButton && pay.payHref ? (
                  <div className="mt-3">
                    <ButtonLink href={pay.payHref} variant="tonal" size="sm">
                      Pay {formatKsh(invoice.totalKes)}
                    </ButtonLink>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <NoticeList notices={model.notices} />
    </Frame>
  );
}

export default function BillingPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  return (
    <DeskPageGate>
      <BillingBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
