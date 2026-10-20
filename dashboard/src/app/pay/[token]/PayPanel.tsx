"use client";

import { useEffect, useState } from "react";
import { PayCard, type PayCardModel } from "@/components/pay/PayCard";
import { PAYMENTS_UNAVAILABLE_NOTICE } from "@/lib/invoicePay/paymentsNotice";

export function PayPanel({ token, initial }: { token: string; initial: PayCardModel }) {
  const [view, setView] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    const load = async () => {
      try {
        const current = new URLSearchParams(window.location.search);
        const query = new URLSearchParams();
        const back = current.get("return");
        const checkoutId = current.get("checkout_id");
        if (back) query.set("return", back);
        if (checkoutId) query.set("checkout_id", checkoutId);
        const suffix = query.size ? `?${query.toString()}` : "";
        const res = await fetch(`/api/pay/${encodeURIComponent(token)}${suffix}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as PayCardModel;
        if (!stop && next && next.state) setView(next);
      } catch {
        /* keep the server view */
      }
    };
    void load();
    return () => {
      stop = true;
    };
  }, [token]);

  useEffect(() => {
    if (view.state !== "checking" || !view.checkoutId || !token) return;
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
      const body = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (body.error === "payments_unavailable") {
        setView((current) => ({ ...current, payLabel: null, notice: PAYMENTS_UNAVAILABLE_NOTICE }));
        setPending(false);
        return;
      }
      if (!res.ok || !body.checkoutUrl) {
        setError(
          body.error === "Previous payment still processing." ? body.error : "Could not start payment."
        );
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
