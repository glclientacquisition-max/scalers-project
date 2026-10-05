"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { btnGhost, btnPrimary } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import { SkeletonList } from "@/components/ui/Skeleton";

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
  const [buyTarget, setBuyTarget] = useState<{ inventoryId: string; e164: string } | null>(null);
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
      setBuyTarget(null);
    }
  }

  return (
    <div className="border-b border-line/70 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-title font-medium text-ink">Buy from SautiKit</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || pending}
          className={btnGhost}
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
        <div className="mt-4">
          <SkeletonList rows={4} />
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No voice numbers available to claim." />
      ) : (
        <>
          <p className="mt-4 text-xs text-[var(--ink-soft)]">
            Showing up to 40 available numbers from SautiKit.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--ink-soft)]">
                <tr className="border-b border-line/70">
                  <th className={adminThClass}>Number</th>
                  <th className={adminThClass}>Monthly</th>
                  <th className={adminThClass}>Capabilities</th>
                  <th className={adminThClass}>Buy</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => (
                  <tr key={row.inventory_id} className="border-t border-line/70">
                    <td className={`${adminTdClass} font-medium whitespace-nowrap tabular-nums`}>{row.e164}</td>
                    <td className={`${adminTdClass} whitespace-nowrap tabular-nums`}>{row.monthly}</td>
                    <td className={adminTdClass}>{(row.capabilities || []).join(", ")}</td>
                    <td className={`${adminTdClass} text-right`}>
                      <button
                        type="button"
                        disabled={Boolean(buyingId) || !buyConfigured}
                        onClick={() => setBuyTarget({ inventoryId: row.inventory_id, e164: row.e164 })}
                        className={btnPrimary}
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
                  className={`${btnGhost} disabled:opacity-40`}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= Math.ceil(rows.length / PAGE_SIZE)}
                  onClick={() => setPage((p) => p + 1)}
                  className={`${btnGhost} disabled:opacity-40`}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      <ConfirmSheet
        open={buyTarget !== null}
        theme="admin"
        pending={buyingId !== null}
        title="Buy this number"
        confirmLabel="Buy"
        onClose={() => {
          if (!buyingId) setBuyTarget(null);
        }}
        onConfirm={() => {
          if (!buyTarget) return;
          void buy(buyTarget.inventoryId, buyTarget.e164);
        }}
      >
        {buyTarget ? (
          <div className="space-y-3">
            <p>Buy {buyTarget.e164} from SautiKit.</p>
            <p>This spends platform wallet credit (KES 100/mo line rental) and adds the number to your pool as Available.</p>
          </div>
        ) : null}
      </ConfirmSheet>
    </div>
  );
}
