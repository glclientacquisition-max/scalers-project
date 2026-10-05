"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { PendingTenant } from "@/lib/didPool";
import {
  adminRowActionClass,
  adminRowDangerClass,
  adminRowMutedClass,
  adminTdClass,
  adminThClass,
} from "@/components/AdminIdentityList";
import { Button, ButtonLink } from "@/components/ui/Button";
import { btnGhost, btnPrimary, deskFieldClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Empty } from "@/components/ui/Empty";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp, type StampTone } from "@/components/ui/Stamp";

const createdLabel = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});

function statusLabel(status: AdminBusiness["status"]) {
  if (status === "waiting") return "Waiting for number";
  if (status === "archived") return "Archived";
  return "Active";
}

function statusTone(status: AdminBusiness["status"]): StampTone {
  if (status === "waiting") return "attention";
  if (status === "active") return "ok";
  return "neutral";
}

function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return createdLabel.format(date);
}

function notifyLabel(raw: string) {
  const value = raw.trim();
  if (!value || value === "pending") return "None";
  return value;
}

function waitingLine(count: number) {
  if (count === 1) return "1 business is waiting.";
  return `${count} businesses are waiting.`;
}

export function AdminBusinessesPanel({
  businesses,
  pendingBusinesses,
  availableDids,
}: {
  businesses: AdminBusiness[];
  pendingBusinesses: PendingTenant[];
  availableDids: { e164: string }[];
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
  const [adjustNote, setAdjustNote] = useState("Ops credit");
  const [releaseTarget, setReleaseTarget] = useState<AdminBusiness | null>(null);
  const [assignTarget, setAssignTarget] = useState<AdminBusiness | null>(null);
  const [pickedE164, setPickedE164] = useState("next");

  const PAGE_SIZE = 25;
  const freeCount = availableDids.length;

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

  async function run(body: Record<string, unknown>, url = "/api/admin/businesses") {
    setError(null);
    const res = await fetch(url, {
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
    setReleaseTarget(null);
    setAssignTarget(null);
    startTransition(() => router.refresh());
    return true;
  }

  function rowActions(b: AdminBusiness) {
    const waiting = b.status === "waiting";
    const hasRealDid = !waiting && b.status === "active";
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {waiting && freeCount === 0 ? (
          <ButtonLink href="/admin/numbers" variant="tonal">
            Add number
          </ButtonLink>
        ) : null}
        {waiting && freeCount > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void run({ action: "assign_next", business_id: b.id })}
            className={adminRowActionClass}
          >
            Assign next number
          </button>
        ) : null}
        {waiting && freeCount > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setAssignTarget(b);
              setPickedE164("next");
            }}
            className={adminRowMutedClass}
          >
            Choose number
          </button>
        ) : null}
        {hasRealDid ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setReleaseTarget(b)}
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
            setAdjustNote("Ops credit");
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

  const emptyTitle = businesses.length === 0 ? "No businesses yet." : "No businesses match.";
  const emptyLine =
    businesses.length === 0 ? "A business shows up here after signup." : "Try another name or number.";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block w-full max-w-md text-sm">
          <span className="font-medium">Search businesses</span>
          <input
            value={query}
            onChange={(e) => setQueryAndReset(e.target.value)}
            className={`mt-1 ${deskFieldClass}`}
            placeholder="Name, number, or notify"
          />
        </label>
        <p className="text-sm text-ink-2">
          <span className="tabular-nums">{pendingBusinesses.length}</span> waiting ·{" "}
          <span className="tabular-nums">{freeCount}</span> numbers available
        </p>
      </div>

      {freeCount === 0 && pendingBusinesses.length > 0 ? (
        <div role="status" className="border-y border-line/70 py-4">
          <p className="text-body font-medium text-ink">No numbers available</p>
          <p className="mt-1 text-meta text-ink-2">{waitingLine(pendingBusinesses.length)}</p>
          <div className="mt-3">
            <ButtonLink href="/admin/numbers">Add number</ButtonLink>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}

      {pageRows.length === 0 ? (
        <Empty title={emptyTitle} line={emptyLine} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-ink-2">
              <tr className="border-b border-line/70">
                <th className={adminThClass}>Business</th>
                <th className={adminThClass}>Number</th>
                <th className={adminThClass}>Notify number</th>
                <th className={adminThClass}>Ledger</th>
                <th className={adminThClass}>Status</th>
                <th className={adminThClass}>Created</th>
                <th className={adminThClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((b) => {
                const waiting = b.status === "waiting";
                const kes = Number(b.wallet_balance_kes ?? b.telecom_wallet_balance_kes ?? 0);
                const packLabel = b.package_name
                  ? `${b.package_name}${b.package_period ? ` / ${b.package_period}` : ""}`
                  : "None";
                const phone = waiting ? "Not assigned" : b.sautikit_virtual_number;
                return (
                  <tr key={b.id} className="border-t border-line/70">
                    <td className={adminTdClass}>
                      <p className={`font-medium text-ink ${deskPreviewClass}`}>{b.business_name}</p>
                      <p className={`mt-0.5 text-meta text-ink-2 ${deskPreviewClass}`}>{packLabel}</p>
                    </td>
                    <td className={`${adminTdClass} tabular-nums`}>{phone}</td>
                    <td className={`${adminTdClass} tabular-nums`}>
                      {notifyLabel(b.whatsapp_notification_number)}
                    </td>
                    <td className={`${adminTdClass} tabular-nums`}>KES {kes.toLocaleString("en-KE")}</td>
                    <td className={adminTdClass}>
                      <Stamp tone={statusTone(b.status)}>{statusLabel(b.status)}</Stamp>
                    </td>
                    <td className={`${adminTdClass} tabular-nums text-ink-2`}>{formatCreated(b.created_at)}</td>
                    <td className={adminTdClass}>{rowActions(b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
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
          <p className="mt-1 text-sm text-ink-2">
            Ops ledger balance. Package assignment stays on Packages. Positive credits, negative debits.
            Writes a ledger entry.
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
                })
              }
              className={btnPrimary}
            >
              Apply
            </button>
            <button type="button" onClick={() => setAdjustId(null)} className={btnGhost}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirmRemoveId ? (
        <div className="border-t border-attention/40 pt-4">
          <p className="font-medium text-attention">Remove this business?</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            This releases its phone number back to Available, deletes its call history, and removes the
            business. Type <span className="font-medium text-ink">REMOVE</span> to confirm.
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
              onClick={() => void run({ action: "remove", business_id: confirmRemoveId })}
              className="inline-flex min-h-11 items-center rounded-xl bg-attention px-4 text-sm font-medium text-accent-on disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Confirm remove
            </button>
            <button type="button" onClick={() => setConfirmRemoveId(null)} className={btnGhost}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <Sheet
        open={releaseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReleaseTarget(null);
        }}
        title="Release this number?"
        description={
          releaseTarget
            ? `${releaseTarget.sautikit_virtual_number} returns to Available. ${releaseTarget.business_name} will wait for a number.`
            : undefined
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setReleaseTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              pending={pending}
              disabled={!releaseTarget}
              onClick={() => {
                if (!releaseTarget) return;
                void run({ action: "release_did", business_id: releaseTarget.id });
              }}
            >
              Release number
            </Button>
          </>
        }
      >
        {error ? (
          <p className="text-body text-attention" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-body text-ink-2">The number stays in the pool as Available.</p>
        )}
      </Sheet>

      <Sheet
        open={assignTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAssignTarget(null);
        }}
        title="Choose a number"
        description={assignTarget ? assignTarget.business_name : undefined}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setAssignTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              pending={pending}
              disabled={!assignTarget}
              onClick={() => {
                if (!assignTarget) return;
                if (pickedE164 === "next") {
                  void run({ action: "assign_next", business_id: assignTarget.id });
                  return;
                }
                void run(
                  { action: "assign_specific", tenant_id: assignTarget.id, e164: pickedE164 },
                  "/api/did-pool"
                );
              }}
            >
              Assign
            </Button>
          </>
        }
      >
        {error ? (
          <p className="mb-3 text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        <DeskSelect
          aria-label="Number"
          className={deskFieldClass}
          portalThemeClass="admin-theme"
          value={pickedE164}
          onChange={setPickedE164}
          options={[
            { value: "next", label: "Next available" },
            ...availableDids.map((row) => ({ value: row.e164, label: row.e164 })),
          ]}
        />
      </Sheet>
    </div>
  );
}
