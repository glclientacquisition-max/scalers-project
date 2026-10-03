"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  chargingModeLabel,
  type AdminBillingClientDetail,
  type BillingHistoryEntry,
} from "@/lib/adminBilling";
import type { BillingMode } from "@/lib/adminWallets";
import { adminTdClass } from "@/components/AdminIdentityList";
import { btnGhost, btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Empty } from "@/components/ui/Empty";
import {
  inboundKesPerMinute,
  outboundKesPerMinute,
} from "@/lib/packageCatalog";
import { assignmentFromBusiness } from "@/lib/packagePriceLabel";
import { usedOfIncluded } from "@/lib/packageUsageAlign";

const ACTOR_STORAGE_KEY = "scalers.ops.actor";

const MODE_OPTIONS: { value: BillingMode; label: string }[] = [
  { value: "off", label: "Beta (free), meter only" },
  { value: "soft", label: "On-demand soft" },
  { value: "hard", label: "On-demand hard" },
];

function planConsequence(mode: BillingMode): string {
  if (mode === "off") {
    return "Beta: meter the package. On-demand ledger is not charged.";
  }
  if (mode === "soft") {
    return "On-demand past included debits the ops ledger when the business opted in. Calls still connect at zero balance.";
  }
  return "On-demand past included debits the ops ledger when opted in. Inbound block at zero balance is not wired yet.";
}

export function AdminBillingDetailPanel({ detail }: { detail: AdminBillingClientDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [actor, setActor] = useState("ops");
  const [history, setHistory] = useState<BillingHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const sub = detail.subscription;
  const opening = assignmentFromBusiness(sub ?? undefined);
  const [packageId, setPackageId] = useState(opening.packageId || detail.packages[0]?.id || "");
  const [period, setPeriod] = useState<"month" | "year">(opening.period || "month");

  const [grantMinutes, setGrantMinutes] = useState("60");
  const [grantNote, setGrantNote] = useState("");
  const [waiveNote, setWaiveNote] = useState("");

  const [mode, setMode] = useState<BillingMode>(detail.row.billing_enforcement);
  const [modeNote, setModeNote] = useState(
    detail.row.billing_enforcement === "off" ? detail.beta_notes || "Beta program" : `On-demand (${detail.row.billing_enforcement})`
  );
  const [waiveNegative, setWaiveNegative] = useState(true);

  const [repairDelta, setRepairDelta] = useState("");
  const [repairNote, setRepairNote] = useState("");

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(ACTOR_STORAGE_KEY);
      if (saved?.trim()) setActor(saved.trim());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/admin/billing?history_for=${encodeURIComponent(detail.row.id)}`
      );
      const json = await res.json().catch(() => ({}));
      if (cancelled || !res.ok) return;
      setHistory(json.history || []);
      setHistoryLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.row.id]);

  function persistActor(next: string) {
    setActor(next);
    try {
      sessionStorage.setItem(ACTOR_STORAGE_KEY, next.trim() || "ops");
    } catch {
      // ignore
    }
  }

  async function post(body: Record<string, unknown>, okText: string) {
    setError(null);
    setStatus(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, actor: actor.trim() || "ops" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Request failed");
      return false;
    }
    setStatus(okText);
    startTransition(() => router.refresh());
    const histRes = await fetch(
      `/api/admin/billing?history_for=${encodeURIComponent(detail.row.id)}`
    );
    const histJson = await histRes.json().catch(() => ({}));
    if (histRes.ok) setHistory(histJson.history || []);
    return true;
  }

  const row = detail.row;
  const rates = detail.rates;
  const minutesLine = usedOfIncluded(row.minutesUsed, row.minutesIncluded);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/billing" className={btnGhost}>
          All clients
        </Link>
        <p className="text-meta text-ink-2">
          {row.statusLabel} · {chargingModeLabel(row.billing_enforcement)}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-ok" role="status">
          {status}
        </p>
      ) : null}

      <label className="block max-w-xs text-sm">
        Ops actor
        <input
          value={actor}
          onChange={(e) => persistActor(e.target.value)}
          className={`mt-1 ${deskFieldClass}`}
          placeholder="your name"
        />
      </label>

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Package</h2>
        <p className="mt-1 text-sm text-ink-2">
          Now {sub?.packageName || "none"}
          {sub?.period ? ` / ${sub.period}` : ""}
        </p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void post(
              {
                action: "assign_package",
                business_id: row.id,
                package_id: packageId,
                period,
              },
              "Package updated."
            );
          }}
        >
          <div className="text-sm sm:col-span-2">
            <span className="font-medium text-ink">Package</span>
            <DeskSelect
              aria-label="Package"
              className={`mt-2 ${deskFieldClass}`}
              portalThemeClass="admin-theme"
              value={packageId}
              onChange={setPackageId}
              options={detail.packages
                .filter((p) => p.isActive || p.id === packageId)
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="text-sm">
            <span className="font-medium text-ink">Period</span>
            <DeskSelect
              aria-label="Period"
              className={`mt-2 ${deskFieldClass}`}
              portalThemeClass="admin-theme"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" disabled={pending || !packageId} className={btnPrimary}>
              Assign or change
            </button>
          </div>
        </form>
      </section>

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Usage</h2>
        <p className="mt-2 text-sm tabular-nums text-ink">
          Minutes {minutesLine}
          {sub
            ? ` · SMS ${usedOfIncluded(sub.usage.smsUsed, sub.usage.smsIncluded)} · Email ${usedOfIncluded(sub.usage.emailUsed, sub.usage.emailIncluded)}`
            : null}
        </p>
        <p className="mt-2 text-sm text-ink-2">
          On-demand rates (read-only): inbound KES {inboundKesPerMinute(rates.inboundKesPerSecond)}/min,
          outbound KES {outboundKesPerMinute(rates.outboundKesPerSecond)}/min. Owner opted in:{" "}
          {row.on_demand_usage_enabled ? "Yes" : "No"}.
        </p>
        {sub?.gap ? <p className="mt-2 text-sm text-attention">{sub.gap}</p> : null}
      </section>

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Charging</h2>
        <p className="mt-1 text-sm text-ink-2">{planConsequence(mode)}</p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const graduating = detail.row.billing_enforcement === "off" && mode !== "off";
            if (graduating) {
              const ok = window.confirm(
                `Start on-demand charging for ${row.business_name}?\n\n${planConsequence(mode)}`
              );
              if (!ok) return;
            }
            void post(
              {
                action: "set_billing_mode",
                business_id: row.id,
                mode,
                note: modeNote.trim(),
                waive_negative: mode === "off" ? waiveNegative : false,
              },
              `Charging mode → ${chargingModeLabel(mode)}.`
            );
          }}
        >
          <div className="text-sm">
            <span className="font-medium text-ink">Mode</span>
            <DeskSelect
              aria-label="Charging mode"
              className={`mt-2 ${deskFieldClass}`}
              portalThemeClass="admin-theme"
              value={mode}
              onChange={setMode}
              options={MODE_OPTIONS}
            />
          </div>
          <label className="text-sm">
            Reason (required)
            <input
              value={modeNote}
              onChange={(e) => setModeNote(e.target.value)}
              className={`mt-2 ${deskFieldClass}`}
            />
          </label>
          {mode === "off" ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={waiveNegative}
                onChange={(e) => setWaiveNegative(e.target.checked)}
              />
              Waive negative on-demand balance when stopping charging
            </label>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending || modeNote.trim().length < 3}
              className={btnPrimary}
            >
              {mode === "off" ? "Stop charging" : "Save charging mode"}
            </button>
          </div>
        </form>
      </section>

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Grant minutes</h2>
        <p className="mt-1 text-sm text-ink-2">
          Adds to included minutes for this period. Does not change on-demand ledger balance.
        </p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post(
              {
                action: "grant_minutes",
                business_id: row.id,
                minutes: Math.floor(Number(grantMinutes)),
                note: grantNote.trim(),
                idempotency_key: crypto.randomUUID(),
              },
              "Minutes granted."
            );
          }}
        >
          <label className="text-sm">
            Minutes
            <input
              type="number"
              min={1}
              value={grantMinutes}
              onChange={(e) => setGrantMinutes(e.target.value)}
              className={`mt-2 ${deskFieldClass}`}
            />
          </label>
          <label className="text-sm">
            Reason (required)
            <input
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
              className={`mt-2 ${deskFieldClass}`}
              placeholder="Beachhead comp, dispute, …"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending || grantNote.trim().length < 3}
              className={btnPrimary}
            >
              Grant minutes
            </button>
          </div>
        </form>
      </section>

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Waive overage</h2>
        <p className="mt-1 text-sm text-ink-2">
          Clears negative on-demand ledger balance for this cycle (trial_credit). Current balance KES{" "}
          {row.wallet_balance_kes.toLocaleString("en-KE")}.
        </p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post(
              {
                action: "waive_overage",
                business_id: row.id,
                note: waiveNote.trim(),
                idempotency_key: crypto.randomUUID(),
              },
              "Overage waived when balance was negative."
            );
          }}
        >
          <label className="text-sm sm:col-span-2">
            Reason (required)
            <input
              value={waiveNote}
              onChange={(e) => setWaiveNote(e.target.value)}
              className={`mt-2 ${deskFieldClass}`}
              placeholder="Goodwill, billing error, …"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending || waiveNote.trim().length < 3 || row.wallet_balance_kes >= 0}
              className={btnPrimary}
            >
              Waive overage
            </button>
          </div>
        </form>
      </section>

      {detail.ledgerRepairEnabled ? (
        <section className="border-b border-line/70 pb-6">
          <h2 className="text-title font-medium text-ink">Ledger repair</h2>
          <p className="mt-1 text-sm text-ink-2">
            Super-admin only (ADMIN_LEDGER_REPAIR=1). Signed KES adjust via adjust_tenant_wallet.
          </p>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                {
                  action: "ledger_repair_adjust",
                  business_id: row.id,
                  delta_kes: Number(repairDelta),
                  note: repairNote.trim(),
                  idempotency_key: crypto.randomUUID(),
                },
                "Ledger adjusted."
              );
            }}
          >
            <label className="text-sm">
              Amount Δ (KES)
              <input
                value={repairDelta}
                onChange={(e) => setRepairDelta(e.target.value)}
                className={`mt-2 ${deskFieldClass}`}
              />
            </label>
            <label className="text-sm">
              Reason
              <input
                value={repairNote}
                onChange={(e) => setRepairNote(e.target.value)}
                className={`mt-2 ${deskFieldClass}`}
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pending || repairNote.trim().length < 3}
                className={btnGhost}
              >
                Apply repair adjust
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section>
        <h2 className="text-title font-medium text-ink">History</h2>
        {!historyLoaded ? (
          <p className="mt-2 text-sm text-ink-2">Loading…</p>
        ) : history.length === 0 ? (
          <Empty title="No history yet." />
        ) : (
          <ul className="mt-4 divide-y divide-line/70">
            {history.map((entry) => (
              <li key={entry.id} className={`flex justify-between gap-3 py-2 text-sm ${adminTdClass}`}>
                <div>
                  <p className="font-medium text-ink">{entry.summary}</p>
                  <p className="text-meta text-ink-2">
                    {new Date(entry.created_at).toLocaleString("en-KE")} · {entry.kind}
                  </p>
                </div>
                {entry.amount_kes != null ? (
                  <p className="shrink-0 tabular-nums text-ink">
                    {entry.amount_kes > 0 ? "+" : ""}
                    {entry.amount_kes.toLocaleString("en-KE")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
