import { Button, pendingDotClass } from "@/components/ui/Button";

export type PayCardModel = {
  state: string;
  title: string;
  businessName: string;
  invoiceNumber: string;
  totalLabel: string | null;
  dueLabel: string | null;
  partLabel: string | null;
  payLabel: string | null;
  checkoutId: string | null;
  notice: string | null;
};

export function PayCard({
  view,
  pending = false,
  error = null,
  onPay,
}: {
  view: PayCardModel;
  pending?: boolean;
  error?: string | null;
  onPay?: () => void;
}) {
  const showBusiness = Boolean(view.businessName) && view.title !== view.businessName;
  const showMoney = Boolean(view.totalLabel) && view.state !== "missing";

  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink">
      <article
        className="mx-auto w-full max-w-md rounded-2xl bg-surface p-5"
        aria-busy={view.state === "checking" || pending || undefined}
      >
        <h1 className="text-title text-ink" aria-live="polite">
          {view.state === "checking" ? (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className={pendingDotClass} />
              {view.title}
            </span>
          ) : (
            view.title
          )}
        </h1>
        {showBusiness ? <p className="mt-1 text-body text-ink-2">{view.businessName}</p> : null}
        {view.invoiceNumber ? (
          <p className="mt-4 text-meta text-ink-3">Invoice {view.invoiceNumber}</p>
        ) : null}
        {showMoney ? (
          <div className="mt-4">
            <p className="text-display tabular-nums text-ink">{view.totalLabel}</p>
            {view.dueLabel ? <p className="mt-1 text-body text-ink-2">{view.dueLabel}</p> : null}
          </div>
        ) : null}
        {view.partLabel ? <p className="mt-4 text-body text-ink">{view.partLabel}</p> : null}
        {view.notice ? <p className="mt-4 text-body text-ink-2">{view.notice}</p> : null}
        {error ? (
          <p className="mt-4 text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        {view.payLabel && onPay ? (
          <div className="mt-6">
            <Button type="button" variant="primary" size="lg" block pending={pending} onClick={onPay}>
              {view.payLabel}
            </Button>
          </div>
        ) : null}
      </article>
    </main>
  );
}
