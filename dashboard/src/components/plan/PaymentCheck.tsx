"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** Polls the server. Payment status is never set here. */
export function PaymentCheck({ active }: { active: boolean }) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!active || stopped) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started >= 120_000) {
        setStopped(true);
        return;
      }
      router.refresh();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [active, stopped, router]);

  if (!active) return null;
  if (!stopped) return <p className="text-body text-ink-2">Checking payment</p>;
  return (
    <Button type="button" variant="tonal" size="sm" onClick={() => router.refresh()}>
      Refresh
    </Button>
  );
}
