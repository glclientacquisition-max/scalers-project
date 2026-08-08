"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { PendingTenant } from "@/lib/didPool";

function statusLabel(status: AdminBusiness["status"]) {
  if (status === "waiting") return "Waiting for number";
  if (status === "archived") return "Archived";
  return "Active";
}

export function AdminBusinessesPanel({
  businesses,
  pendingBusinesses,
  availableDidCount,
}: {
  businesses: AdminBusiness[];
  pendingBusinesses: PendingTenant[];
  availableDidCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [deltaKes, setDeltaKes] = useState("1000");
  const [adjustNote, setAdjustNote] = useState("Wallet top-up");

  const PAGE_SIZE = 25;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return businesses;
    return businesses.filter(
      (b) =>
        b.business_name.toLowerCase().includes(q) ||
        b.sautikit_virtual_number.toLowerCase().includes(q) ||
        b.whatsapp_notification_number.toLowerCase().includes(q)
    );
  }, [businesses, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function setQueryAndReset(next: string) {
    setQuery(next);
    setPage(1);
  }

  function Actions({ b }: { b: AdminBusiness }) {
    const waiting = b.status === "waiting";
    const hasRealDid = !waiting && b.status === "active";
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {waiting ? (
          <button
            type="button"
            disabled={pending || availableDidCount === 0}
            onClick={() => void run({ action: "assign_next", business_id: b.id })}
            className="text-sm text-[var(--accent)] hover:text-[var(--accent-deep)] disabled:opacity-50"
          >
            Assign next number
          </button>
        ) : null}
        {hasRealDid ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void run({ action: "release_did", business_id: b.id })}
            className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
          >
            Release number
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setAdjustId(b.id);
            setDeltaKes("1000");
            setAdjustNote("Wallet top-up");
          }}
          className="text-sm text-[var(--accent)] hover:text-[var(--accent-deep)]"
        >
          Adjust wallet
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirmRemoveId(b.id);
            setConfirmText("");
          }}
          className="text-sm text-[var(--warn)] hover:underline"
        >
          Remove
        </button>
      </div>
    );
  }

  async function run(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Request failed");
      return false;
    }
    setConfirmRemoveId(null);
    setConfirmText("");
    setAdjustId(null);
    startTransition(() => router.refresh());
    return true;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block w-full max-w-md text-sm">
          <span className="font-medium">Search businesses</span>
          <input
            value={query}
            onChange={(e) => setQueryAndReset(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
            placeholder="Name or phone number"
          />
        </label>
        <p className="text-sm text-[var(--ink-soft)]">
          {pendingBusinesses.length} waiting · {availableDidCount} numbers available
        </p>
      </div>

      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}

      {/* Mobile / tablet cards */}
      <ul className="space-y-3 lg:hidden">
        {pageRows.length === 0 ? (
          <li className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-10 text-center text-[var(--ink-soft)]">
            No businesses match.
          </li>
        ) : (
          pageRows.map((b) => {
            const waiting = b.status === "waiting";
            const kes = Number(b.wallet_balance_kes ?? b.telecom_wallet_balance_kes ?? 0);
            return (
              <li
                key={b.id}
                className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--ink)]">{b.business_name}</p>
                    <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
                      {waiting ? "Not assigned" : b.sautikit_virtual_number}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      Wallet KES {kes.toLocaleString("en-KE")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs">
                    {statusLabel(b.status)}
                  </span>
                </div>
                <div className="mt-3 border-t border-[var(--line)]/60 pt-3">
                  <Actions b={b} />
                </div>
              </li>
            );
          })
        )}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] lg:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-[var(--bg-deep)]/70 text-[var(--ink-soft)]">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Phone number</th>
              <th className="px-4 py-3 font-medium">Wallet</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--ink-soft)]">
                  No businesses match.
                </td>
              </tr>
            ) : (
              pageRows.map((b) => {
                const waiting = b.status === "waiting";
                const kes = Number(b.wallet_balance_kes ?? b.telecom_wallet_balance_kes ?? 0);
                return (
                  <tr key={b.id} className="border-t border-[var(--line)]/70 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{b.business_name}</p>
                      <p className="text-xs text-[var(--ink-soft)]">
                        {new Date(b.created_at).toLocaleDateString("en-KE")}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {waiting ? (
                        <span className="text-[var(--ink-soft)]">Not assigned</span>
                      ) : (
                        b.sautikit_virtual_number
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs leading-relaxed">
                      <p>KES {kes.toLocaleString("en-KE")}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs">
                        {statusLabel(b.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Actions b={b} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--ink-soft)]">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {adjustId ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <p className="font-medium">Adjust wallet</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Single KES prepaid wallet. Positive credits, negative debits. Writes a ledger entry.
            M-Pesa top-up comes next.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Amount Δ (KES)
              <input
                value={deltaKes}
                onChange={(e) => setDeltaKes(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              />
            </label>
            <label className="text-sm">
              Note
              <input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void run({
                  action: "adjust_wallet",
                  business_id: adjustId,
                  delta_kes: Number(deltaKes) || 0,
                  note: adjustNote,
                }).then(() => setAdjustId(null))
              }
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setAdjustId(null)}
              className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirmRemoveId ? (
        <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-5">
          <p className="font-medium text-[var(--warn)]">Remove this business?</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)] leading-relaxed">
            This releases its phone number back to Available, deletes its call history, and removes
            the business. Type <span className="font-medium text-[var(--ink)]">REMOVE</span> to
            confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="mt-3 w-full max-w-xs rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            placeholder="REMOVE"
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending || confirmText !== "REMOVE"}
              onClick={() =>
                void run({ action: "remove", business_id: confirmRemoveId })
              }
              className="rounded-xl bg-[var(--warn)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Confirm remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemoveId(null)}
              className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
