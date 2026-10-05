"use client";

import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";

type AvailableRow = {
  inventory_id: string;
  e164: string;
  monthly: string;
  capabilities: string[];
};

export function BuyNumberPanel({
  open,
  onOpenChange,
  onBought,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBought: (e164: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<AvailableRow[]>([]);
  const [buyConfigured, setBuyConfigured] = useState(true);
  const [pick, setPick] = useState<AvailableRow | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/buy-number");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load.");
      setRows(json.available || []);
      setBuyConfigured(Boolean(json.buyConfigured));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function buy(row: AvailableRow) {
    setBuyingId(row.inventory_id);
    setError("");
    try {
      const res = await fetch("/api/admin/buy-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory_id: row.inventory_id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not buy.");
      setPick(null);
      onBought(row.e164);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy.");
    } finally {
      setBuyingId(null);
    }
  }

  return (
    <>
      <Sheet
        open={open && !pick}
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
        title="Buy"
        theme="admin"
      >
        {error ? (
          <p className="text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        {!buyConfigured ? <p className="text-body text-ink-2">Buy is off.</p> : null}
        {loading ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <Empty title="None to buy." />
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((row) => (
              <ListRow
                key={row.inventory_id}
                title={row.e164}
                when={row.monthly}
                onOpen={buyConfigured ? () => setPick(row) : undefined}
              />
            ))}
          </ul>
        )}
      </Sheet>
      <ConfirmSheet
        open={open && pick !== null}
        theme="admin"
        title="Buy this number?"
        confirmLabel="Buy"
        pending={Boolean(pick && buyingId === pick.inventory_id)}
        onClose={() => setPick(null)}
        onConfirm={() => {
          if (pick) void buy(pick);
        }}
      >
        {pick ? `${pick.e164}. ${pick.monthly} a month from line money.` : null}
      </ConfirmSheet>
    </>
  );
}
