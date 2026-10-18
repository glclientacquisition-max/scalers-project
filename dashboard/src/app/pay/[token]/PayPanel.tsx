"use client";

import { useEffect, useState } from "react";
import { PayCard, type PayCardModel } from "@/components/pay/PayCard";

export function PayPanel({ token, initial }: { token: string; initial: PayCardModel }) {
  const [view, setView] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (view.state !== "checking" || !view.checkoutId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/pay/${encodeURIComponent(token)}?return=1&checkout_id=${encodeURIComponent(view.checkoutId || "")}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const next = (await res.json()) as PayCardModel;
        if (!stop) setView(next);
      } catch {
        /* keep checking */
      }
    };
    const id = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token, view.state, view.checkoutId]);

  async function onPay() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/checkout`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { checkoutUrl?: string };
      if (!res.ok || !body.checkoutUrl) {
        setError("Could not start payment.");
        setPending(false);
        return;
      }
      window.location.assign(body.checkoutUrl);
    } catch {
      setError("Could not start payment.");
      setPending(false);
    }
  }

  return <PayCard view={view} pending={pending} error={error} onPay={view.payLabel ? onPay : undefined} />;
}
