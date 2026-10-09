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
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { btnGhost, deskFieldClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import {
  inboundKesPerMinute,
  outboundKesPerMinute,
} from "@/lib/packageCatalog";
import { assignmentFromBusiness } from "@/lib/packagePriceLabel";
import { usedOfIncluded } from "@/lib/packageUsageAlign";
import { chargingAction, packageChange, requestErrorText } from "@/lib/adminBillingCopy";

const MODE_OPTIONS: { value: BillingMode; label: string }[] = [
  { value: "off", label: "Beta (free), meter only" },
  { value: "soft", label: "On-demand soft" },
  { value: "hard", label: "On-demand hard" },
];

type BillingTask = "package" | "charging" | "grant";

function planConsequence(mode: BillingMode): string {
  if (mode === "off") {
    return "Beta: meter the package. On-demand is not charged.";
  }
  if (mode === "soft") {
    return "On-demand past included is charged at the rate card when the business opted in. Calls still connect.";
  }
  return "On-demand past included is charged at the rate card when opted in. Inbound block is not wired yet.";
}

function SheetNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="pb-3 text-body text-attention" role="alert">
      {error}
    </p>
  );
}

const sheetLabelClass = "mb-1.5 block text-meta font-medium text-ink";

export function AdminBillingDetailPanel({ detail }: { detail: AdminBillingClientDetail }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [task, setTask] = useState<BillingTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [packageConfirmOpen, setPackageConfirmOpen] = useState(false);
  const [history, setHistory] = useState<BillingHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const sub = detail.subscription;
  const opening = assignmentFromBusiness(sub ?? undefined);
  const [packageId, setPackageId] = useState(opening.packageId || detail.packages[0]?.id || "");
  const [period, setPeriod] = useState<"month" | "year">(opening.period || "month");

  const [grantMinutes, setGrantMinutes] = useState("60");
  const [grantNote, setGrantNote] = useState("");

  const [mode, setMode] = useState<BillingMode>(detail.row.billing_enforcement);
  const [modeNote, setModeNote] = useState(
    detail.row.billing_enforcement === "off" ? detail.beta_notes || "Beta program" : `On-demand (${detail.row.billing_enforcement})`
  );

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

  function openTask(next: BillingTask) {
    setError(null);
    setStatus(null);
    setTask(next);
  }

  async function post(body: Record<string, unknown>, okText: string) {
    setError(null);
    setStatus(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(requestErrorText(json));
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

  async function submit(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    const ok = await post(body, okText);
    setBusy(false);
    if (ok) setTask(null);
  }

  async function submitCharging() {
    if (chargingStep.disabled) return;
    if (chargingStep.needsConfirm) {
      setTask(null);
      setChargeOpen(true);
      return;
    }
    await submit(
      {
        action: "set_billing_mode",
        business_id: row.id,
        mode,
        note: modeNote.trim(),
      },
      `Charging is now ${chargingModeLabel(mode)}.`
    );
  }

  async function confirmPackage() {
    setBusy(true);
    const ok = await post(
      {
        action: "assign_package",
        business_id: row.id,
        package_id: packageId,
        period,
      },
      `Package is now ${chosenPackage?.name ?? "updated"}.`
    );
    setBusy(false);
    if (ok) {
      setPackageConfirmOpen(false);
      setTask(null);
    }
  }

  async function confirmCharge() {
    setSavingCharge(true);
    await post(
      {
        action: "set_billing_mode",
        business_id: detail.row.id,
        mode,
        note: modeNote.trim(),
      },
      `Charging is now ${chargingModeLabel(mode)}.`
    );
    setSavingCharge(false);
    setChargeOpen(false);
  }

  const row = detail.row;
  const rates = detail.rates;
  const minutesLine = usedOfIncluded(row.minutesUsed, row.minutesIncluded);
  const nowPackage = `Now ${sub?.packageName || "none"}${sub?.period ? ` / ${sub.period}` : ""}`;
  const chargingStep = chargingAction(row.billing_enforcement, mode);
  const chosenPackage = detail.packages.find((p) => p.id === packageId) ?? null;
  const currentPackage = sub?.packageId ? detail.packages.find((p) => p.id === sub.packageId) ?? null : null;
  const change = chosenPackage
    ? packageChange({
        current: currentPackage ? { ...currentPackage, period: sub?.period ?? null } : null,
        next: chosenPackage,
        period,
        minutesIncluded: row.minutesIncluded,
        minutesUsed: row.minutesUsed,
      })
    : null;

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

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Package</h2>
        <p className="mt-1 text-sm text-ink-2">{nowPackage}</p>
        <Button type="button" variant="tonal" className="mt-4" onClick={() => openTask("package")}>
          {sub?.packageId ? "Change package" : "Assign package"}
        </Button>
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
        <p className="mt-1 text-sm text-ink-2">{planConsequence(row.billing_enforcement)}</p>
        <Button type="button" variant="tonal" className="mt-4" onClick={() => openTask("charging")}>
          Change charging
        </Button>
      </section>

      <section className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Grant minutes</h2>
        <p className="mt-1 text-sm text-ink-2">
          Adds to included minutes for this period.
        </p>
        <Button type="button" variant="tonal" className="mt-4" onClick={() => openTask("grant")}>
          Grant minutes
        </Button>
      </section>

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
                <div className="min-w-0">
                  <p className="font-medium text-ink">{entry.title}</p>
                  {entry.detail ? <p className="break-words text-ink">{entry.detail}</p> : null}
                  <p className="text-meta text-ink-2">
                    {[entry.when, entry.actor].filter(Boolean).join(" · ")}
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

      <Sheet
        open={task === "package"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Package"
        description={nowPackage}
        theme="admin"
        footer={
          <Button
            type="button"
            block
            disabled={!change}
            onClick={() => {
              setError(null);
              setTask(null);
              setPackageConfirmOpen(true);
            }}
          >
            Review change
          </Button>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <div>
            <span className={sheetLabelClass}>Package</span>
            <DeskSelect
              aria-label="Package"
              className={deskFieldClass}
              portalThemeClass="admin-theme"
              value={packageId}
              onChange={setPackageId}
              options={detail.packages
                .filter((p) => p.isActive || p.id === packageId)
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div>
            <span className={sheetLabelClass}>Period</span>
            <DeskSelect
              aria-label="Period"
              className={deskFieldClass}
              portalThemeClass="admin-theme"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          </div>
        </div>
      </Sheet>

      <Sheet
        open={task === "charging"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Charging"
        description={`Now ${chargingModeLabel(row.billing_enforcement)}`}
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={busy}
            disabled={chargingStep.disabled || modeNote.trim().length < 3}
            onClick={() => void submitCharging()}
          >
            {chargingStep.label}
          </Button>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <div>
            <span className={sheetLabelClass}>Mode</span>
            <DeskSelect
              aria-label="Charging mode"
              className={deskFieldClass}
              portalThemeClass="admin-theme"
              value={mode}
              onChange={setMode}
              options={MODE_OPTIONS}
            />
          </div>
          <p className="text-meta text-ink-2">{planConsequence(mode)}</p>
          <Field id="bill-mode-note" label="Reason" required>
            {(props) => (
              <Input {...props} value={modeNote} onChange={(e) => setModeNote(e.target.value)} />
            )}
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={task === "grant"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Grant minutes"
        description="Adds to included minutes for this period."
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={busy}
            disabled={grantNote.trim().length < 3}
            onClick={() =>
              void submit(
                {
                  action: "grant_minutes",
                  business_id: row.id,
                  minutes: Math.floor(Number(grantMinutes)),
                  note: grantNote.trim(),
                  idempotency_key: crypto.randomUUID(),
                },
                "Minutes granted."
              )
            }
          >
            Grant minutes
          </Button>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <Field id="bill-grant-minutes" label="Minutes" required>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                inputMode="numeric"
                className="tabular-nums"
                value={grantMinutes}
                onChange={(e) => setGrantMinutes(e.target.value)}
              />
            )}
          </Field>
          <Field id="bill-grant-note" label="Reason" required>
            {(props) => (
              <Input
                {...props}
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
                placeholder="Comp for a dropped call"
              />
            )}
          </Field>
        </div>
      </Sheet>

      <ConfirmSheet
        open={chargeOpen}
        theme="admin"
        pending={savingCharge}
        title="Start on-demand charging"
        confirmLabel="Start charging"
        onClose={() => {
          if (!savingCharge) setChargeOpen(false);
        }}
        onConfirm={() => void confirmCharge()}
      >
        <div className="space-y-3">
          <p>Start on-demand charging for {row.business_name}.</p>
          <p>{planConsequence(mode)}</p>
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={packageConfirmOpen && Boolean(change)}
        theme="admin"
        pending={busy}
        title={change?.title ?? "Change package?"}
        confirmLabel={change?.confirmLabel ?? "Change package"}
        onClose={() => {
          if (!busy) setPackageConfirmOpen(false);
        }}
        onConfirm={() => void confirmPackage()}
      >
        <SheetNote error={error} />
        <p className="pb-3">{row.business_name}</p>
        <ul className="list-disc space-y-2 pl-5">
          {change?.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ConfirmSheet>
    </div>
  );
}
