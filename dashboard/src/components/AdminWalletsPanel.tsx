"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminWalletRow, BillingMode } from "@/lib/adminWallets";
import type { WalletLedgerRow } from "@/lib/wallet";

const PRESETS = [500, 1000, 5000, 10000];

function statusLabel(s: AdminWalletRow["wallet_status"]) {
  if (s === "beta") return "Beta (free)";
  if (s === "overdrawn") return "Overdrawn";
  if (s === "low") return "Low";
  if (s === "archived") return "Archived";
  return "OK";
}

export function AdminWalletsPanel({
  rows,
  betaCount,
  prepaidCount,
  lowCount,
  overdrawnCount,
  totalFloatKes,
}: {
  rows: AdminWalletRow[];
  betaCount: number;
  prepaidCount: number;
  lowCount: number;
  overdrawnCount: number;
  totalFloatKes: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "beta" | "prepaid" | "low" | "overdrawn">("all");
  const [error, setError] = useState<string | null>(null);
  const [creditId, setCreditId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerRow[]>([]);
  const [deltaKes, setDeltaKes] = useState("1000");
  const [note, setNote] = useState("Wallet top-up");
  const [actor, setActor] = useState("ops");
  const [mode, setMode] = useState<BillingMode>("off");
  const [waiveNegative, setWaiveNegative] = useState(true);
  const [modeNote, setModeNote] = useState("Beta program whitelist");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "beta" && r.wallet_status !== "beta") return false;
      if (filter === "prepaid" && r.billing_enforcement === "off") return false;
      if (filter === "low" && r.wallet_status !== "low") return false;
      if (filter === "overdrawn" && r.wallet_status !== "overdrawn") return false;
      if (!q) return true;
      return (
        r.business_name.toLowerCase().includes(q) ||
        r.sautikit_virtual_number.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  const creditTarget = rows.find((r) => r.id === creditId) || null;
  const modeTarget = rows.find((r) => r.id === modeId) || null;
  const ledgerTarget = rows.find((r) => r.id === ledgerId) || null;

  async function run(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Request failed");
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  async function openLedger(id: string) {
    setError(null);
    setLedgerId(id);
    setLedger([]);
    const res = await fetch(`/api/admin/wallets?ledger_for=${encodeURIComponent(id)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not load ledger");
      return;
    }
    setLedger(json.ledger || []);
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Beta (free)" value={betaCount} />
        <Kpi label="Prepaid" value={prepaidCount} />
        <Kpi label="Low balance" value={lowCount} warn={lowCount > 0} />
        <Kpi label="Overdrawn" value={overdrawnCount} warn={overdrawnCount > 0} />
        <Kpi label="Float (KES)" value={totalFloatKes.toLocaleString("en-KE")} />
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm grow min-w-[200px]">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
            placeholder="Business or number"
          />
        </label>
        <label className="text-sm">
          Filter
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="mt-1 block rounded-xl border border-[var(--line)] bg-white px-3 py-2"
          >
            <option value="all">All</option>
            <option value="beta">Beta only</option>
            <option value="prepaid">Prepaid only</option>
            <option value="low">Low</option>
            <option value="overdrawn">Overdrawn</option>
          </select>
        </label>
        <label className="text-sm">
          Ops actor
          <input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="mt-1 w-40 rounded-xl border border-[var(--line)] bg-white px-3 py-2"
            placeholder="your name"
          />
        </label>
      </div>

      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-[var(--bg-deep)]/70 text-[var(--ink-soft)]">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--ink-soft)]">
                  No wallets match.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-[var(--line)]/70 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.business_name}</p>
                    <p className="text-xs text-[var(--ink-soft)]">{r.sautikit_virtual_number}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      className={
                        r.wallet_balance_kes < 0 ? "font-medium text-[var(--warn)]" : "font-medium"
                      }
                    >
                      KES {r.wallet_balance_kes.toLocaleString("en-KE")}
                    </p>
                    <p className="text-xs text-[var(--ink-soft)]">{statusLabel(r.wallet_status)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.billing_enforcement === "off" ? (
                      <>
                        <p>Beta</p>
                        {r.beta_notes ? (
                          <p className="text-[var(--ink-soft)]">{r.beta_notes}</p>
                        ) : null}
                      </>
                    ) : (
                      <p>Prepaid ({r.billing_enforcement})</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-x-3 gap-y-2">
                      <button
                        type="button"
                        disabled={pending}
                        className="text-sm text-[var(--accent)]"
                        onClick={() => {
                          setCreditId(r.id);
                          setDeltaKes("1000");
                          setNote("Wallet top-up");
                        }}
                      >
                        Credit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="text-sm text-[var(--accent)]"
                        onClick={() => {
                          setModeId(r.id);
                          setMode(r.billing_enforcement === "off" ? "soft" : "off");
                          setModeNote(
                            r.billing_enforcement === "off"
                              ? "Graduate to prepaid"
                              : "Beta program whitelist"
                          );
                          setWaiveNegative(true);
                        }}
                      >
                        Plan
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="text-sm text-[var(--ink-soft)]"
                        onClick={() => void openLedger(r.id)}
                      >
                        Ledger
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creditTarget ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <p className="font-medium">Credit / debit — {creditTarget.business_name}</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Current balance KES {creditTarget.wallet_balance_kes.toLocaleString("en-KE")}. Positive
            credits, negative debits. Requires a reason. Logged to ops audit.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDeltaKes(String(p))}
                className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs"
              >
                +{p.toLocaleString("en-KE")}
              </button>
            ))}
          </div>
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
              Reason (required)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            New balance preview: KES{" "}
            {(creditTarget.wallet_balance_kes + (Number(deltaKes) || 0)).toLocaleString("en-KE")}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() =>
                void run({
                  action: "adjust_wallet",
                  business_id: creditTarget.id,
                  delta_kes: Number(deltaKes) || 0,
                  note,
                  actor,
                  idempotency_key: crypto.randomUUID(),
                }).then((ok) => {
                  if (ok) setCreditId(null);
                })
              }
            >
              Apply
            </button>
            <button
              type="button"
              className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
              onClick={() => setCreditId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {modeTarget ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <p className="font-medium">Billing plan — {modeTarget.business_name}</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            <strong>Beta (off)</strong> = whitelist, meter only, no charges.{" "}
            <strong>Soft</strong> = prepaid debit, calls still work. <strong>Hard</strong> = prepaid
            (block later).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as BillingMode)}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              >
                <option value="off">Beta — free (off)</option>
                <option value="soft">Prepaid — soft</option>
                <option value="hard">Prepaid — hard</option>
              </select>
            </label>
            <label className="text-sm">
              Note
              <input
                value={modeNote}
                onChange={(e) => setModeNote(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              />
            </label>
          </div>
          {mode === "off" ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={waiveNegative}
                onChange={(e) => setWaiveNegative(e.target.checked)}
              />
              Waive negative balance when moving to beta
            </label>
          ) : null}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() =>
                void run({
                  action: "set_billing_mode",
                  business_id: modeTarget.id,
                  mode,
                  note: modeNote,
                  actor,
                  waive_negative: waiveNegative,
                }).then((ok) => {
                  if (ok) setModeId(null);
                })
              }
            >
              Save plan
            </button>
            <button
              type="button"
              className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm"
              onClick={() => setModeId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {ledgerTarget ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">Ledger — {ledgerTarget.business_name}</p>
            <button
              type="button"
              className="text-sm text-[var(--ink-soft)]"
              onClick={() => setLedgerId(null)}
            >
              Close
            </button>
          </div>
          {ledger.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">No entries.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {ledger.map((row) => (
                <li key={row.id} className="flex justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{row.kind}</p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {new Date(row.created_at).toLocaleString("en-KE")}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0">
                    {row.amount_kes > 0 ? "+" : ""}
                    {row.amount_kes.toLocaleString("en-KE")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <p className={`mt-1 font-display text-2xl ${warn ? "text-[var(--warn)]" : ""}`}>{value}</p>
    </div>
  );
}
