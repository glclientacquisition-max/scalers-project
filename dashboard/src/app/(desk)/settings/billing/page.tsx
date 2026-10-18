import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { BillingNote } from "@/components/DeskBillingBanner";
import { NoticeList } from "@/components/plan/NoticeList";
import { OwnerInvoiceList, type OwnerInvoiceListItem } from "@/components/plan/OwnerInvoiceList";
import { PaymentCheck } from "@/components/plan/PaymentCheck";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { nairobiDay } from "@/lib/billingBanner";
import { invoicePayState } from "@/lib/invoicePayState";
import { formatKsh } from "@/lib/planPricing";
import { memberCan } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan, type OwnerInvoiceRow } from "@/lib/ownerPlanLoad";

function statusLabel(invoice: OwnerInvoiceRow, payLabel: string | null, due: string | null): string {
  if (payLabel === "Paid" || payLabel === "Checking payment") return payLabel;
  if (due) return `Due by ${due}`;
  return "Open";
}

function toListItem(invoice: OwnerInvoiceRow, fromPay: boolean, showPayLinks: boolean): OwnerInvoiceListItem | null {
  const pay = invoicePayState({
    status: invoice.status,
    payToken: showPayLinks ? invoice.payToken : null,
    returnedFromPay: fromPay && invoice.status === "open",
  });
  if (pay.hidden) return null;
  const due = nairobiDay(invoice.dueAt);
  return {
    id: invoice.id,
    number: invoice.number,
    totalLabel: formatKsh(invoice.totalKes),
    statusLabel: statusLabel(invoice, pay.label, due),
    payHref: pay.showPayButton ? pay.payHref : null,
    payLabel: pay.showPayButton ? `Pay ${formatKsh(invoice.totalKes)}` : null,
  };
}

async function BillingBody({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  if (!(await memberCan("billing.manage"))) return <DeskNoAccess what="Billing" />;
  const fromPay = (await searchParams).from === "pay";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const loaded = await loadOwnerPlan(tenant.id);
  if (!loaded.ok) return <DeskLoadError>Could not load Billing.</DeskLoadError>;
  const model = loaded.model;
  if (model.freeBeta || !model.surface.showInvoices) {
    return (
      <SettingsPlanFrame title="Billing">
        <h2 className="mt-6 text-title text-ink">Free during beta</h2>
        <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
      </SettingsPlanFrame>
    );
  }

  const checking = fromPay && model.invoices.some((invoice) => invoice.status === "open");
  const invoices = model.invoices.flatMap((invoice) => {
    const item = toListItem(invoice, fromPay, model.surface.showPayLinks);
    return item ? [item] : [];
  });

  return (
    <SettingsPlanFrame title="Billing">
      {model.surface.showDunningBanner && model.banner ? <BillingNote banner={model.banner} /> : null}
      <div className="mt-4">
        <PaymentCheck active={checking} />
      </div>
      <OwnerInvoiceList invoices={invoices} />
      <NoticeList notices={model.notices} />
    </SettingsPlanFrame>
  );
}

export default function BillingPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  return (
    <DeskPageGate>
      <BillingBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
