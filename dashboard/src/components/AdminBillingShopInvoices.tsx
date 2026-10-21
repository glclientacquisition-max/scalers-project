"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import { Skeleton } from "@/components/ui/Skeleton";
import { requestErrorText } from "@/lib/adminBillingCopy";

type InvoiceRow = {
  id: string;
  number: string;
  statusLabel: string;
  totalLabel: string;
  balanceLabel: string;
  pdfPath: string;
  htmlPath: string;
  canMintPayLink: boolean;
};

export function AdminBillingShopInvoices({ businessId }: { businessId: string }) {
  const [items, setItems] = useState<InvoiceRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [mintingId, setMintingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNote(null);
    try {
      const res = await fetch(`/api/admin/billing?invoices_for=${encodeURIComponent(businessId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailed(true);
        return;
      }
      if (json.missing) {
        setMissing(true);
        setItems([]);
        return;
      }
      setFailed(false);
      setMissing(false);
      setItems(json.invoices || []);
    } catch {
      setFailed(true);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mintPayLink(invoiceId: string) {
    if (mintingId) return;
    setMintingId(invoiceId);
    setNote(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mint_pay_link", business_id: businessId, invoice_id: invoiceId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(requestErrorText(json, "Could not mint a pay link."));
        return;
      }
      if (json.pay_path) {
        window.open(json.pay_path, "_blank", "noopener,noreferrer");
      }
    } catch {
      setNote("Could not mint a pay link.");
    } finally {
      setMintingId(null);
    }
  }

  if (failed) {
    return (
      <div className="rounded-2xl border border-hairline/70 bg-surface px-4 py-4">
        <p className="text-body text-attention">Could not load invoices.</p>
        <Button type="button" variant="tonal" size="sm" className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="rounded-2xl border border-hairline/70 bg-surface-2/40 px-4 py-4">
        <p className="text-body text-ink-2">Invoices are not on this environment yet.</p>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="rounded-2xl border border-hairline/70 bg-surface px-4 py-4" aria-busy="true">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="mt-2 h-3.5 w-1/3" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline/70 bg-surface px-4 py-2">
        <Empty title="No invoices" line="Issued invoices show here." />
      </div>
    );
  }

  const stampTone = (label: string) => (label === "Overdue" ? "attention" : label === "Open" ? "live" : "neutral");

  return (
    <section className="overflow-hidden rounded-2xl border border-hairline/70 bg-surface" aria-label="Invoices">
      {note ? (
        <p className="border-b border-hairline/70 px-4 py-2 text-body text-attention" role="alert">
          {note}
        </p>
      ) : null}
      <ul className="divide-y divide-hairline/70">
        {items.map((item) => (
          <li key={item.id}>
            <ListRow
              title={item.number}
              when={item.balanceLabel}
              preview={`${item.statusLabel} · ${item.totalLabel}`}
              stamp={<Stamp tone={stampTone(item.statusLabel)}>{item.statusLabel}</Stamp>}
              actions={
                <div className="flex flex-wrap justify-end gap-2">
                  <ButtonLink href={item.htmlPath} size="sm" variant="tonal" target="_blank" rel="noopener noreferrer">
                    View
                  </ButtonLink>
                  <ButtonLink href={item.pdfPath} size="sm" variant="tonal" target="_blank" rel="noopener noreferrer">
                    PDF
                  </ButtonLink>
                  {item.canMintPayLink ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="tonal"
                      pending={mintingId === item.id}
                      onClick={() => void mintPayLink(item.id)}
                    >
                      Pay link
                    </Button>
                  ) : null}
                </div>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
