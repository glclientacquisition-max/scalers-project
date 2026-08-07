"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AvailableRow = {
  inventory_id: string;
  e164: string;
  monthly: string;
  capabilities: string[];
};

export function BuyNumberPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<AvailableRow[]>([]);
  const [buyConfigured, setBuyConfigured] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/buy-number");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load inventory");
      setRows(json.available || []);
      setBuyConfigured(Boolean(json.buyConfigured));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function buy(inventoryId: string, e164: string) {
    if (
      !window.confirm(
        `Buy ${e164} from SautiKit?\n\nThis spends platform wallet credit (KES 100/mo line rental) and adds the number to your pool as Available.`
      )
    ) {
      return;
    }
    setBuyingId(inventoryId);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/buy-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory_id: inventoryId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Buy failed");
      setStatus(`Bought ${e164} — added to pool as available.`);
      startTransition(() => router.refresh());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buy failed");
    } finally {
      setBuyingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-tight">Buy from SautiKit</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)] max-w-xl leading-relaxed">
            Claims a number on your platform wallet, points voice webhooks at Railway, and drops
            it into the pool as Available.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || pending}
          className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--accent)] disabled:opacity-60"
        >
          Refresh list
        </button>
      </div>

      {!buyConfigured ? (
        <p className="mt-4 text-sm text-[var(--warn)]">
          Set <code>SAUTIKIT_ADMIN_OPS_KEY</code> on Vercel with the <code>numbers.claim</code>{" "}
          scope (Key B), then redeploy.
        </p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-[var(--warn)]">{error}</p> : null}
      {status ? <p className="mt-4 text-sm text-[var(--ok)]">{status}</p> : null}

      {loading ? (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">Loading inventory…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">No voice numbers available to claim.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--ink-soft)]">
              <tr className="border-b border-[var(--line)]/70">
                <th className="py-2 pr-4 font-medium">Number</th>
                <th className="py-2 pr-4 font-medium">Monthly</th>
                <th className="py-2 pr-4 font-medium">Capabilities</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.inventory_id} className="border-b border-[var(--line)]/40 last:border-0">
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{row.e164}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">{row.monthly}</td>
                  <td className="py-2.5 pr-4">{(row.capabilities || []).join(", ")}</td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      disabled={Boolean(buyingId) || !buyConfigured}
                      onClick={() => void buy(row.inventory_id, row.e164)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-50"
                    >
                      {buyingId === row.inventory_id ? "Buying…" : "Buy"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
