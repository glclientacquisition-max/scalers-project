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
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

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
      return;
    }
    setConfirmRemoveId(null);
    setConfirmText("");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block w-full max-w-md text-sm">
          <span className="font-medium">Search businesses</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
            placeholder="Name or phone number"
          />
        </label>
        <p className="text-sm text-[var(--ink-soft)]">
          {pendingBusinesses.length} waiting · {availableDidCount} numbers available
        </p>
      </div>

      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--bg-deep)]/70 text-[var(--ink-soft)]">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Phone number</th>
              <th className="px-4 py-3 font-medium">Alerts</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--ink-soft)]">
                  No businesses match.
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                const waiting = b.status === "waiting";
                const hasRealDid = !waiting && b.status === "active";
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
                    <td className="px-4 py-3">{b.whatsapp_notification_number || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs">
                        {statusLabel(b.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2 items-start">
                        {waiting ? (
                          <button
                            type="button"
                            disabled={pending || availableDidCount === 0}
                            onClick={() =>
                              void run({ action: "assign_next", business_id: b.id })
                            }
                            className="text-sm text-[var(--accent)] hover:text-[var(--accent-deep)] disabled:opacity-50"
                          >
                            Assign next number
                          </button>
                        ) : null}
                        {hasRealDid ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void run({ action: "release_did", business_id: b.id })
                            }
                            className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
                          >
                            Release number
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setConfirmRemoveId(b.id);
                            setConfirmText("");
                          }}
                          className="text-sm text-[var(--warn)] hover:underline"
                        >
                          Remove business
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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
