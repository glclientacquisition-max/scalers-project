"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminWalletRow, BillingMode } from "@/lib/adminWallets";
import type { WalletLedgerRow } from "@/lib/wallet";
import { btnGhost, btnPrimary, deskFieldClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Empty } from "@/components/ui/Empty";
import { adminRowActionClass, adminRowMutedClass, adminTdClass, adminThClass } from "@/components/AdminIdentityList";

const CREDIT_PRESETS = [500, 1000, 5000, 10000];
const DEBIT_PRESETS = [-500, -1000];
const ACTOR_STORAGE_KEY = "scalers.ops.actor";
const OPS_CREDIT_NOTE = "Ops credit";
const OPS_ADJUSTMENT_NOTE = "Ops adjustment";

type LedgerFilter = "all" | "beta" | "charging" | "low" | "overdrawn";

const FILTER_OPTIONS: { value: LedgerFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "beta", label: "Beta only" },
  { value: "charging", label: "Charging only" },
  { value: "low", label: "Low" },
  { value: "overdrawn", label: "Overdrawn" },
];

const MODE_OPTIONS: { value: BillingMode; label: string }[] = [
  { value: "off", label: "Beta (free), meter only" },
  { value: "soft", label: "On-demand (soft), debit ledger, do not block" },
  { value: "hard", label: "On-demand (hard), debit ledger; block later" },
];

function statusLabel(s: AdminWalletRow["wallet_status"]) {
  if (s === "beta") return "Beta (free)";
  if (s === "overdrawn") return "Overdrawn";
  if (s === "low") return "Low";
  if (s === "archived") return "Archived";
  return "OK";
}

function planLabel(mode: BillingMode): string {
  if (mode === "off") return "Beta (free)";
  if (mode === "soft") return "On-demand (soft)";
  return "On-demand (hard)";
}

function planConsequence(mode: BillingMode): string {
  if (mode === "off") {
    return "Beta: meter package usage. Ledger is not charged.";
  }
  if (mode === "soft") {
    return "On-demand past included debits the ops ledger when the business opted in. Calls still connect at zero balance.";
  }
  return "On-demand past included debits the ops ledger when opted in. Inbound block at zero balance is not wired yet.";
}

function defaultModeNote(mode: BillingMode, row?: AdminWalletRow | null): string {
  if (mode === "off") return row?.beta_notes || "Beta program whitelist";
  return `On-demand (${mode})`;
}

export function AdminWalletsPanel({
  rows,
  betaCount,
  chargingCount,
  lowCount,
  overdrawnCount,
  totalLedgerBalanceKes,
}: {
  rows: AdminWalletRow[];
  betaCount: number;
  chargingCount: number;
  lowCount: number;
  overdrawnCount: number;
  totalLedgerBalanceKes: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [creditId, setCreditId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerRow[]>([]);
  const [deltaKes, setDeltaKes] = useState("1000");
  const [note, setNote] = useState(OPS_CREDIT_NOTE);
  const [actor, setActor] = useState("ops");
  const [mode, setMode] = useState<BillingMode>("off");
  const [waiveNegative, setWaiveNegative] = useState(true);
  const [modeNote, setModeNote] = useState("Beta program whitelist");
  const [initialMode, setInitialMode] = useState<BillingMode>("off");
  const [initialModeNote, setInitialModeNote] = useState("");

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(ACTOR_STORAGE_KEY);
      if (saved && saved.trim()) setActor(saved.trim());
    } catch {
      // ignore storage failures
    }
  }, []);

  function persistActor(next: string) {
    setActor(next);
    try {
      sessionStorage.setItem(ACTOR_STORAGE_KEY, next.trim() || "ops");
    } catch {
      // ignore storage failures
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "beta" && r.wallet_status !== "beta") return false;
      if (filter === "charging" && r.billing_enforcement === "off") return false;
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

  const deltaNum = Number(deltaKes);
  const creditValid =
    Boolean(creditTarget) &&
    Number.isFinite(deltaNum) &&
    deltaNum !== 0 &&
    note.trim().length >= 3 &&
    actor.trim().length > 0;

  const graduatingToCharging =
    Boolean(modeTarget) && initialMode === "off" && mode !== "off";
  const returningToBeta =
    Boolean(modeTarget) && initialMode !== "off" && mode === "off";
  const planDirty =
    Boolean(modeTarget) && (mode !== initialMode || modeNote.trim() !== initialModeNote.trim());
  const planValid =
    Boolean(modeTarget) &&
    planDirty &&
    modeNote.trim().length >= 3 &&
    actor.trim().length > 0;

  function closePanels() {
    setCreditId(null);
    setModeId(null);
    setLedgerId(null);
    setLedger([]);
  }

  function openCredit(row: AdminWalletRow) {
    setError(null);
    setStatus(null);
    setModeId(null);
    setLedgerId(null);
    setLedger([]);
    setCreditId(row.id);
    setDeltaKes("1000");
    setNote(OPS_CREDIT_NOTE);
  }

  function openPlan(row: AdminWalletRow) {
    setError(null);
    setStatus(null);
    setCreditId(null);
    setLedgerId(null);
    setLedger([]);
    setModeId(row.id);
    setMode(row.billing_enforcement);
    setInitialMode(row.billing_enforcement);
    const nextNote = defaultModeNote(row.billing_enforcement, row);
    setModeNote(nextNote);
    setInitialModeNote(nextNote);
    setWaiveNegative(row.billing_enforcement !== "off");
  }

  async function run(body: Record<string, unknown>) {
    setError(null);
    setStatus(null);
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
    setStatus(null);
    setCreditId(null);
    setModeId(null);
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

  async function applyCredit() {
    if (!creditTarget || !creditValid) return;
    const ok = await run({
      action: "adjust_wallet",
      business_id: creditTarget.id,
      delta_kes: deltaNum,
      note: note.trim(),
      actor: actor.trim() || "ops",
      idempotency_key: crypto.randomUUID(),
    });
    if (ok) {
      const verb = deltaNum > 0 ? "Credited" : "Debited";
      setStatus(
        `${verb} ${creditTarget.business_name} by KES ${Math.abs(deltaNum).toLocaleString("en-KE")}.`
      );
      setCreditId(null);
    }
  }

  async function savePlan() {
    if (!modeTarget || !planValid) return;

    if (graduatingToCharging) {
      const balance = modeTarget.wallet_balance_kes;
      const balanceLine =
        balance <= 0
          ? `\n\nLedger is KES ${balance.toLocaleString("en-KE")}. They will be overdrawn or low once charging starts.`
          : `\n\nCurrent ledger KES ${balance.toLocaleString("en-KE")}.`;
      const confirmed = window.confirm(
        `Start on-demand charging for ${modeTarget.business_name}?\n\n` +
          `${planConsequence(mode)}` +
          balanceLine +
          `\n\nThis turns on ledger debits for on-demand past included.`
      );
      if (!confirmed) return;
    }

    if (returningToBeta && waiveNegative && modeTarget.wallet_balance_kes < 0) {
      const confirmed = window.confirm(
        `Move ${modeTarget.business_name} back to free beta and waive KES ${Math.abs(
          modeTarget.wallet_balance_kes
        ).toLocaleString("en-KE")} of negative balance?`
      );
      if (!confirmed) return;
    }

    const ok = await run({
      action: "set_billing_mode",
      business_id: modeTarget.id,
      mode,
      note: modeNote.trim(),
      actor: actor.trim() || "ops",
      waive_negative: mode === "off" ? waiveNegative : false,
    });
    if (ok) {
      setStatus(`Updated plan for ${modeTarget.business_name} → ${planLabel(mode)}.`);
      setModeId(null);
    }
  }

  return (
    <div className="space-y-4">
      <section
        className="grid grid-cols-2 border-y border-line/70 sm:grid-cols-5"
        aria-label="Ledger totals"
      >
        <Kpi label="Beta (free)" value={betaCount} />
        <Kpi label="Charging" value={chargingCount} />
        <Kpi label="Low balance" value={lowCount} warn={lowCount > 0} />
        <Kpi label="Overdrawn" value={overdrawnCount} warn={overdrawnCount > 0} />
        <Kpi
          label="Ledger balance (KES)"
          value={totalLedgerBalanceKes.toLocaleString("en-KE")}
          caption="Ops sum, not customer checkout"
        />
      </section>

      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="min-w-[200px] grow text-sm">
          Search
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`mt-1 ${deskFieldClass}`}
            placeholder="Business or number"
          />
        </label>
        <div className="text-sm">
          <span className="font-medium text-ink">Filter</span>
          <DeskSelect
            aria-label="Filter businesses"
            className={`mt-1 min-w-[11rem] ${deskFieldClass}`}
            portalThemeClass="admin-theme"
            value={filter}
            onChange={setFilter}
            options={FILTER_OPTIONS}
          />
        </div>
        <label className="text-sm">
          Ops actor
          <input
            value={actor}
            onChange={(e) => persistActor(e.target.value)}
            className={`mt-1 w-40 ${deskFieldClass}`}
            placeholder="your name"
          />
        </label>
      </div>

      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}
      {status ? <p className="text-sm text-[var(--ok)]">{status}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-ink-2">
            <tr className="border-b border-line/70">
              <th className={adminThClass}>Business</th>
              <th className={adminThClass}>Ledger (KES)</th>
              <th className={adminThClass}>Plan</th>
              <th className={adminThClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <Empty
                    title="No businesses match."
                    line="Assign a package on Packages or widen your filter."
                    action={
                      <Link href="/admin/packages" className={btnGhost}>
                        Open Packages
                      </Link>
                    }
                  />
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-line/70">
                  <td className={adminTdClass}>
                    <p className={`text-body font-medium text-ink ${deskPreviewClass}`}>{r.business_name}</p>
                    <p className={`mt-0.5 text-meta text-ink-2 ${deskPreviewClass}`}>{r.sautikit_virtual_number}</p>
                  </td>
                  <td className={adminTdClass}>
                    <p
                      className={
                        r.wallet_balance_kes < 0 ? "font-medium text-[var(--warn)]" : "font-medium"
                      }
                    >
                      KES {r.wallet_balance_kes.toLocaleString("en-KE")}
                    </p>
                    <p className="text-xs text-[var(--ink-soft)]">{statusLabel(r.wallet_status)}</p>
                  </td>
                  <td className={`${adminTdClass} text-meta`}>
                    <p>{planLabel(r.billing_enforcement)}</p>
                    {r.billing_enforcement === "off" && r.beta_notes ? (
                      <p className="text-[var(--ink-soft)]">{r.beta_notes}</p>
                    ) : null}
                  </td>
                  <td className={adminTdClass}>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        className={adminRowActionClass}
                        onClick={() => openCredit(r)}
                      >
                        Credit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={adminRowActionClass}
                        onClick={() => openPlan(r)}
                      >
                        Plan
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={adminRowMutedClass}
                        onClick={() => void openLedger(r.id)}
                      >
                        History
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
        <div className="border-t border-line/70 pt-3">
          <p className="font-medium">Credit / debit: {creditTarget.business_name}</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Current ledger KES {creditTarget.wallet_balance_kes.toLocaleString("en-KE")}. Positive
            credits, negative debits. Reason required (min 3 chars). Logged to ops audit as{" "}
            <span className="font-medium text-[var(--ink)]">{actor.trim() || "ops"}</span>.
          </p>
          {creditTarget.billing_enforcement === "off" ? (
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              This workspace is on free beta (not charged). Adjustments still change the displayed
              ledger for when you start on-demand charging.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {CREDIT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setDeltaKes(String(p));
                  if (!note.trim() || note === OPS_ADJUSTMENT_NOTE) setNote(OPS_CREDIT_NOTE);
                }}
                className={adminRowMutedClass}
              >
                +{p.toLocaleString("en-KE")}
              </button>
            ))}
            {DEBIT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setDeltaKes(String(p));
                  if (!note.trim() || note === OPS_CREDIT_NOTE) setNote(OPS_ADJUSTMENT_NOTE);
                }}
                className={adminRowMutedClass}
              >
                {p.toLocaleString("en-KE")}
              </button>
            ))}
          </div>
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
              Reason (required)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={`mt-1 ${deskFieldClass}`}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            New ledger preview: KES{" "}
            {(creditTarget.wallet_balance_kes + (Number.isFinite(deltaNum) ? deltaNum : 0)).toLocaleString(
              "en-KE"
            )}
          </p>
          {!creditValid ? (
            <p className="mt-2 text-xs text-[var(--warn)]">
              Enter a non-zero amount and a reason (at least 3 characters).
            </p>
          ) : null}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending || !creditValid}
              className={btnPrimary}
              onClick={() => void applyCredit()}
            >
              {deltaNum < 0 ? "Apply debit" : "Apply credit"}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => setCreditId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {modeTarget ? (
        <div className="border-t border-line/70 pt-3">
          <p className="font-medium">Billing plan: {modeTarget.business_name}</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Current: <span className="font-medium text-[var(--ink)]">{planLabel(initialMode)}</span>
            {" · "}
            Ledger KES {modeTarget.wallet_balance_kes.toLocaleString("en-KE")}.
          </p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">{planConsequence(mode)}</p>
          {graduatingToCharging ? (
            <p className="mt-2 text-sm text-[var(--warn)]">
              Leaving beta turns on on-demand ledger debits past included. You will be asked to confirm
              before save.
              {modeTarget.wallet_balance_kes <= 0
                ? ` Ledger is KES ${modeTarget.wallet_balance_kes.toLocaleString("en-KE")}. Assign a package or post an ops credit if you do not want them overdrawn when charging starts.`
                : null}
            </p>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="text-sm">
              <span className="font-medium text-ink">Mode</span>
              <DeskSelect
                aria-label="Billing mode"
                className={`mt-1 ${deskFieldClass}`}
                portalThemeClass="admin-theme"
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  if (
                    modeNote.trim() === initialModeNote.trim() ||
                    modeNote.trim() === defaultModeNote(mode, modeTarget)
                  ) {
                    setModeNote(defaultModeNote(next, modeTarget));
                  }
                }}
                options={MODE_OPTIONS}
              />
            </div>
            <label className="text-sm">
              Note
              <input
                value={modeNote}
                onChange={(e) => setModeNote(e.target.value)}
                className={`mt-1 ${deskFieldClass}`}
              />
            </label>
          </div>
          {mode === "off" ? (
            <div className="mt-3 space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={waiveNegative}
                  onChange={(e) => setWaiveNegative(e.target.checked)}
                />
                Waive negative balance when moving to beta
              </label>
              {waiveNegative && modeTarget.wallet_balance_kes < 0 ? (
                <p className="text-xs text-[var(--ink-soft)]">
                  Will credit KES {Math.abs(modeTarget.wallet_balance_kes).toLocaleString("en-KE")} so
                  ledger returns to 0.
                </p>
              ) : null}
            </div>
          ) : null}
          {!planValid ? (
            <p className="mt-3 text-xs text-[var(--ink-soft)]">
              {planDirty
                ? "Note must be at least 3 characters."
                : "Change the mode or note to enable save."}
            </p>
          ) : null}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={pending || !planValid}
              className={btnPrimary}
              onClick={() => void savePlan()}
            >
              {graduatingToCharging ? "Start charging" : "Save plan"}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => setModeId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {ledgerTarget ? (
        <div className="border-t border-line/70 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">Ledger: {ledgerTarget.business_name}</p>
            <button
              type="button"
              className={adminRowMutedClass}
              onClick={() => closePanels()}
            >
              Close
            </button>
          </div>
          {ledger.length === 0 ? (
            <Empty title="No entries." />
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
  caption,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
  caption?: string;
}) {
  return (
    <div className="border-t border-line/70 px-3 py-2 sm:border-t-0 sm:border-l sm:px-4 sm:py-2.5 sm:first:border-l-0">
      <p className={`text-body font-medium tabular-nums ${warn ? "text-attention" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 truncate text-meta text-ink-2">{label}</p>
      {caption ? <p className="truncate text-meta text-ink-3">{caption}</p> : null}
    </div>
  );
}
