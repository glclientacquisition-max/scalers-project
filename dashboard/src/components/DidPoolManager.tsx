"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DidPoolRow, PendingTenant } from "@/lib/didPool";

export function DidPoolManager({
  pool,
  pendingBusinesses,
}: {
  pool: DidPoolRow[];
  pendingBusinesses: PendingTenant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [e164, setE164] = useState("");
  const [notes, setNotes] = useState("");
  const [assignBusinessId, setAssignBusinessId] = useState(pendingBusinesses[0]?.id || "");

  async function run(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/did-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Request failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  const available = pool.filter((r) => r.status === "available").length;

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Add number to pool</h2>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "add", e164, notes });
            setE164("");
            setNotes("");
          }}
        >
          <label className="block flex-1 text-sm">
            <span className="font-medium">Phone number (E.164)</span>
            <input
              value={e164}
              onChange={(e) => setE164(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              placeholder="+2547…"
            />
          </label>
          <label className="block flex-1 text-sm">
            <span className="font-medium">Notes</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              placeholder="Optional"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-white text-sm font-medium hover:bg-[var(--accent-deep)] disabled:opacity-60"
          >
            Add to pool
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Assign to a business</h2>
        {pendingBusinesses.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            No businesses are waiting for a phone number.
          </p>
        ) : (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ action: "assign_next", tenant_id: assignBusinessId });
            }}
          >
            <label className="block flex-1 text-sm">
              <span className="font-medium">Business</span>
              <select
                value={assignBusinessId}
                onChange={(e) => setAssignBusinessId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              >
                {pendingBusinesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.business_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending || available === 0}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-white text-sm font-medium hover:bg-[var(--accent-deep)] disabled:opacity-60"
            >
              Assign next available
            </button>
          </form>
        )}
      </div>

      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}

      <ul className="space-y-3 lg:hidden">
        {pool.length === 0 ? (
          <li className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
            Pool empty. Add a pre-bought SautiKit number above.
          </li>
        ) : (
          pool.slice(0, 50).map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{row.e164}</p>
                <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs capitalize">
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {row.tenants?.business_name ||
                  (row.tenant_id ? "Linked business" : "Unassigned")}
              </p>
              {row.notes ? (
                <p className="mt-1 text-xs text-[var(--ink-soft)]">{row.notes}</p>
              ) : null}
            </li>
          ))
        )}
      </ul>
      {pool.length > 50 ? (
        <p className="text-xs text-[var(--ink-soft)] lg:hidden">Showing first 50 of {pool.length}</p>
      ) : null}

      <div className="hidden overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] lg:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--bg-deep)]/70 text-[var(--ink-soft)]">
            <tr>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {pool.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--ink-soft)]">
                  Pool empty. Add a pre-bought SautiKit number above.
                </td>
              </tr>
            ) : (
              pool.map((row) => (
                <tr key={row.id} className="border-t border-[var(--line)]/70">
                  <td className="px-4 py-3 font-medium">{row.e164}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs capitalize">
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.tenants?.business_name ||
                      (row.tenant_id ? "Linked business" : "n/a")}
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-soft)]">{row.notes || "n/a"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
