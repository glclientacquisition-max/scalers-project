"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { PendingTenant } from "@/lib/didPool";
import {
  AdminIdentityList,
  AdminIdentityRow,
  adminRowActionClass,
  adminRowDangerClass,
  adminRowMutedClass,
} from "@/components/AdminIdentityList";
import { btnGhost, btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";

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
        b.whatsapp_notification_number.toLowerCase().includes(q) ||
        (b.package_name || "").toLowerCase().includes(q)
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
            className={adminRowActionClass}
          >
            Assign next number
          </button>
        ) : null}
        {hasRealDid ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void run({ action: "release_did", business_id: b.id })}
            className={adminRowMutedClass}
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
          className={adminRowActionClass}
        >
          Adjust ledger
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirmRemoveId(b.id);
            setConfirmText("");
          }}
          className={adminRowDangerClass}
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
            className={`mt-1 ${deskFieldClass}`}
            placeholder="Name or phone number"
          />
        </label>
        <p className="text-sm text-[var(--ink-soft)]">
          {pendingBusinesses.length} waiting · {availableDidCount} numbers available
        </p>
      </div>

      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}

      {pageRows.length === 0 ? (
        <Empty title="No businesses match." />
      ) : (
        <AdminIdentityList label="Businesses">
          {pageRows.map((b) => {
            const waiting = b.status === "waiting";
            const kes = Number(b.wallet_balance_kes ?? b.telecom_wallet_balance_kes ?? 0);
            const packLabel = b.package_name
              ? `${b.package_name}${b.package_period ? ` / ${b.package_period}` : ""}`
              : "None";
            const phone = waiting ? "Not assigned" : b.sautikit_virtual_number;
            return (
              <AdminIdentityRow
                key={b.id}
                title={b.business_name}
                line={`${phone} · ${packLabel}`}
                aside={`KES ${kes.toLocaleString("en-KE")} · ${statusLabel(b.status)}`}
                actions={<Actions b={b} />}
              />
            );
          })}
        </AdminIdentityList>
      )}

      {filtered.length > PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--ink-soft)]">
            {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`${btnGhost} disabled:opacity-40`}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={`${btnGhost} disabled:opacity-40`}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {adjustId ? (
        <div className="border-t border-line/70 pt-4">
          <p className="font-medium">Adjust ledger</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Ops ledger balance only. Customer billing is package plus on-demand on Packages. Positive
            credits, negative debits. Writes a ledger entry.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Amount Δ (KES)
              <input
                value={deltaKes}
                onChange={(e) => setDeltaKes(e.target.value)}
                className={`mt-1 ${deskFieldClass}`}
              />
            </label>
            <label className="text-sm">
              Note
              <input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                className={`mt-1 ${deskFieldClass}`}
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
              className={btnPrimary}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setAdjustId(null)}
              className={btnGhost}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirmRemoveId ? (
        <div className="border-t border-attention/40 pt-4">
          <p className="font-medium text-[var(--warn)]">Remove this business?</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)] leading-relaxed">
            This releases its phone number back to Available, deletes its call history, and removes
            the business. Type <span className="font-medium text-[var(--ink)]">REMOVE</span> to
            confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className={`mt-3 max-w-xs ${deskFieldClass}`}
            placeholder="REMOVE"
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending || confirmText !== "REMOVE"}
              onClick={() =>
                void run({ action: "remove", business_id: confirmRemoveId })
              }
              className="inline-flex min-h-11 items-center rounded-xl bg-attention px-4 text-sm font-medium text-accent-on disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Confirm remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemoveId(null)}
              className={btnGhost}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
