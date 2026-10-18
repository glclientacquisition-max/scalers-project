"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { OwnerInvoiceList } from "@/components/plan/OwnerInvoiceList";
import { PaymentCheck } from "@/components/plan/PaymentCheck";
import { mapBillingHistory, payLinkDestination, type BillingHistoryBody, type MappedInvoice } from "@/lib/billingHistory";

export function BillingHistory({ fromPay }: { fromPay: boolean }) {
  const [items, setItems] = useState<MappedInvoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/invoices", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as BillingHistoryBody;
      setFailed(false);
      setItems(mapBillingHistory(body, { fromPay }));
    } catch {
      setFailed(true);
    }
  }, [fromPay]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pay(item: MappedInvoice) {
    if (!item.payLinkPath || payingId) return;
    setPayingId(item.id);
    setNote(null);
    try {
      const res = await fetch(item.payLinkPath, { method: "POST", cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { pay_path?: unknown; reason?: unknown } | null;
      const dest = payLinkDestination(body);
      if (dest.href) {
        window.location.assign(dest.href);
        return;
      }
      setNote(dest.reason);
    } catch {
      setNote("Could not open the pay link.");
    } finally {
      setPayingId(null);
    }
  }

  if (failed) {
    return (
      <div className="mt-4">
        <p className="text-body text-attention">Could not load invoices.</p>
        <Button type="button" variant="tonal" size="sm" className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface" aria-busy="true" aria-label="Loading">
        <div className="px-4 py-3">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-2 h-3.5 w-1/4" />
        </div>
      </div>
    );
  }

  const checking = items.some((item) => item.statusLabel === "Checking payment");

  return (
    <div className="mt-4">
      <PaymentCheck active={fromPay && checking} onRefresh={load} />
      <OwnerInvoiceList
        invoices={items.map((item) => ({
          id: item.id,
          number: item.number,
          totalLabel: item.totalLabel,
          statusLabel: item.statusLabel,
          payLabel: item.payLabel,
          payPending: payingId === item.id,
          onPay: item.payLinkPath ? () => void pay(item) : undefined,
        }))}
      />
      {note ? <p className="mt-3 text-body text-attention">{note}</p> : null}
    </div>
  );
}
