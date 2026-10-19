"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminModeLabel,
  type AdminBillingClientDetail,
  type BillingHistoryEntry,
} from "@/lib/adminBilling";
import type { BillingMode } from "@/lib/adminWallets";
import { chargeAmount, chargeKind, formatCreated } from "@/lib/adminBusinessUi";
import type { WalletLedgerRow } from "@/lib/wallet";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { assignmentFromBusiness } from "@/lib/packagePriceLabel";
import { usedOfIncluded } from "@/lib/packageUsageAlign";
import { chargingAction, packageChange, requestErrorText } from "@/lib/adminBillingCopy";
import { CheckoutReviewResolve } from "@/components/CheckoutReviewResolve";

type MoneyTask = "package" | "plan" | "grant" | "charges" | "history" | "remove";

const PLAN_OPTIONS: { value: BillingMode; label: string }[] = [
  { value: "off", label: "Beta · Meter only" },
  { value: "soft", label: "Charging · On-demand" },
  { value: "hard", label: "Charging · Block at cap" },
];

function planConsequence(mode: BillingMode): string {
  if (mode === "off") return "Meter the package. No charges.";
  if (mode === "soft") {
    return "Past included is charged when the owner opted in on Usage. Calls still connect.";
  }
  return "Past included is charged when opted in. Inbound block at cap is not wired yet.";
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

export function AdminShopMoneyPanel({ detail }: { detail: AdminBillingClientDetail }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [task, setTask] = useState<MoneyTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [packageConfirmOpen, setPackageConfirmOpen] = useState(false);
  const [history, setHistory] = useState<BillingHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [charges, setCharges] = useState<WalletLedgerRow[]>([]);

  const sub = detail.subscription;
  const row = detail.row;
  const opening = assignmentFromBusiness(sub ?? undefined);
  const [packageId, setPackageId] = useState(opening.packageId || detail.packages[0]?.id || "");
  const [period, setPeriod] = useState<"month" | "year">(opening.period || "month");

  const [grantMinutes, setGrantMinutes] = useState("60");
  const [grantNote, setGrantNote] = useState("");
  const [grantKey, setGrantKey] = useState(() => crypto.randomUUID());

  const [mode, setMode] = useState<BillingMode>(row.billing_enforcement);
  const [modeNote, setModeNote] = useState(
    row.billing_enforcement === "off" ? detail.beta_notes || "Beta program" : adminModeLabel(row.billing_enforcement),
  );

  const [removeWhen, setRemoveWhen] = useState<"now" | "period_end">("period_end");
  const [removeNote, setRemoveNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/admin/billing?history_for=${encodeURIComponent(row.id)}`);
      const json = await res.json().catch(() => ({}));
      if (cancelled || !res.ok) return;
      setHistory(json.history || []);
      setHistoryLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  async function loadCharges() {
    setCharges([]);
    try {
      const res = await fetch(`/api/admin/wallets?ledger_for=${encodeURIComponent(row.id)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(requestErrorText(json, "Could not load charges."));
      setCharges(json.ledger || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load charges.");
    }
  }

  function openTask(next: MoneyTask) {
    setError(null);
    setStatus(null);
    setTask(next);
    if (next === "charges") void loadCharges();
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
    const histRes = await fetch(`/api/admin/billing?history_for=${encodeURIComponent(row.id)}`);
    const histJson = await histRes.json().catch(() => ({}));
    if (histRes.ok) setHistory(histJson.history || []);
    return true;
  }

  async function submit(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    const ok = await post(body, okText);
    setBusy(false);
    if (ok) setTask(null);
    return ok;
  }

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

  const packagePreview = sub?.packageName
    ? `${sub.packageName}${sub.period ? ` / ${sub.period}` : ""}`
    : "No package assigned";
  const usagePreview = sub?.gap
    ? sub.gap
    : `${usedOfIncluded(row.minutesUsed, row.minutesIncluded)} min`;
  const planPreview = adminModeLabel(row.billing_enforcement);
  const optInPreview = row.on_demand_usage_enabled ? "Yes" : "No";

  async function submitPlan() {
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
      `Plan is now ${adminModeLabel(mode)}.`,
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
      `Package is now ${chosenPackage?.name ?? "updated"}.`,
    );
    setBusy(false);
    if (ok) {
      setPackageConfirmOpen(false);
      setTask(null);
    }
  }

  async function confirmRemove() {
    if (removeNote.trim().length < 3) return;
    setBusy(true);
    const ok = await post(
      {
        action: "unassign_package",
        business_id: row.id,
        when: removeWhen,
        note: removeNote.trim(),
      },
      removeWhen === "now" ? "Package removed." : "Package ends at period boundary.",
    );
    setBusy(false);
    if (ok) {
      setTask(null);
      setRemoveNote("");
    }
  }

  async function confirmCharge() {
    setSavingCharge(true);
    await post(
      {
        action: "set_billing_mode",
        business_id: row.id,
        mode,
        note: modeNote.trim(),
      },
      `Plan is now ${adminModeLabel(mode)}.`,
    );
    setSavingCharge(false);
    setChargeOpen(false);
  }

  return (
    <>
      {status ? (
        <p className="px-4 text-body text-ok" role="status">
          {status}
        </p>
      ) : null}
      {error && !task ? (
        <p className="px-4 text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}

      <CheckoutReviewResolve
        link={false}
        reviews={detail.checkoutReviews.map((review) => ({
          businessId: row.id,
          businessName: row.business_name,
          providerRef: review.providerRef,
          getKes: review.getKes,
          seenKes: review.seenKes,
          reason: review.reason,
          invoiceId: review.invoiceId,
        }))}
      />
      <ListRow title="Package" preview={packagePreview} onOpen={() => openTask("package")} />
      {sub?.packageId ? (
        <ListRow title="Remove package" preview="Now or end of period" onOpen={() => openTask("remove")} />
      ) : null}
      <ListRow title="Plan" preview={planPreview} onOpen={() => openTask("plan")} />
      <ListRow title="Usage" preview={usagePreview} />
      <ListRow title="Owner opted in" preview={optInPreview} />
      <ListRow title="Charges" preview="Ledger lines this period" onOpen={() => openTask("charges")} />
      <ListRow title="Grant minutes" preview="Adds to included this period" onOpen={() => openTask("grant")} />
      <ListRow
        title="History"
        preview={historyLoaded ? `${history.length} recent lines` : "Activity and charges"}
        onOpen={() => openTask("history")}
      />
      <ListRow
        title="Invoices"
        href={`/admin/billing/invoices?business=${row.id}`}
        preview={
          detail.invoiceCount == null
            ? "Could not load"
            : detail.invoiceCount === 0
              ? "None yet"
              : `${detail.invoiceCount} on file`
        }
      />

      <Sheet
        open={task === "package"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Package"
        description={packagePreview}
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
        open={task === "plan"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Plan"
        description={`Now ${planPreview}`}
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={busy}
            disabled={chargingStep.disabled || modeNote.trim().length < 3}
            onClick={() => void submitPlan()}
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
              aria-label="Plan mode"
              className={deskFieldClass}
              portalThemeClass="admin-theme"
              value={mode}
              onChange={setMode}
              options={PLAN_OPTIONS}
            />
          </div>
          <p className="text-meta text-ink-2">{planConsequence(mode)}</p>
          <Field id="shop-plan-note" label="Reason" required>
            {(props) => <Input {...props} value={modeNote} onChange={(e) => setModeNote(e.target.value)} />}
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={task === "grant"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Grant minutes"
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
                  idempotency_key: grantKey,
                },
                "Minutes granted.",
              ).then((ok) => {
                if (ok) setGrantKey(crypto.randomUUID());
              })
            }
          >
            Grant minutes
          </Button>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <Field id="shop-grant-minutes" label="Minutes" required>
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
          <Field id="shop-grant-note" label="Reason" required>
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

      <Sheet
        open={task === "charges"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Charges"
        theme="admin"
      >
        <SheetNote error={error} />
        {charges.length === 0 ? (
          <Empty className="px-0 py-8" title="No charges." line="Charge lines show when on-demand debits run." />
        ) : (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {charges.map((line) => (
              <ListRow
                key={line.id}
                title={chargeKind(line.kind)}
                preview={line.note || chargeAmount(line.amount_kes)}
                when={formatCreated(line.created_at)}
              />
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet
        open={task === "history"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="History"
        theme="admin"
      >
        {!historyLoaded ? (
          <p className="text-body text-ink-2">Loading…</p>
        ) : history.length === 0 ? (
          <Empty className="px-0 py-8" title="No history yet." />
        ) : (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {history.map((entry) => (
              <ListRow
                key={entry.id}
                title={entry.title}
                preview={entry.detail || undefined}
                when={[entry.when, entry.actor].filter(Boolean).join(" · ")}
              />
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet
        open={task === "remove"}
        onOpenChange={(next) => {
          if (!next) setTask(null);
        }}
        title="Remove package"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            variant="danger"
            pending={busy}
            disabled={removeNote.trim().length < 3}
            onClick={() => void confirmRemove()}
          >
            Remove package
          </Button>
        }
      >
        <SheetNote error={error} />
        <Segmented
          className="-mx-5 px-5 sm:-mx-6 sm:px-6"
          label="When"
          items={[
            { key: "period_end", label: "End of period", active: removeWhen === "period_end" },
            { key: "now", label: "Now", active: removeWhen === "now" },
          ]}
          onSelect={(key) => setRemoveWhen(key === "now" ? "now" : "period_end")}
        />
        <Field id="shop-remove-note" label="Reason" required>
          {(props) => (
            <Input {...props} value={removeNote} onChange={(e) => setRemoveNote(e.target.value)} />
          )}
        </Field>
      </Sheet>

      <ConfirmSheet
        open={chargeOpen}
        theme="admin"
        pending={savingCharge}
        title="Start charging?"
        confirmLabel="Start charging"
        onClose={() => {
          if (!savingCharge) setChargeOpen(false);
        }}
        onConfirm={() => void confirmCharge()}
      >
        <div className="space-y-3">
          <p>Start charging for {row.business_name}.</p>
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
    </>
  );
}
