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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

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
      setStatus(`Bought ${e164}. Added to pool as available.`);
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
        <>
          <p className="mt-4 text-xs text-[var(--ink-soft)]">
            Showing up to 40 available numbers from SautiKit.
          </p>
          <ul className="mt-3 space-y-2 sm:hidden">
            {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => (
              <li
                key={row.inventory_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{row.e164}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{row.monthly}</p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(buyingId) || !buyConfigured}
                  onClick={() => void buy(row.inventory_id, row.e164)}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {buyingId === row.inventory_id ? "Buying…" : "Buy"}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 hidden overflow-x-auto sm:block">
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
                {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => (
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
          {rows.length > PAGE_SIZE ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--ink-soft)]">
                Page {page} of {Math.ceil(rows.length / PAGE_SIZE)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= Math.ceil(rows.length / PAGE_SIZE)}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
