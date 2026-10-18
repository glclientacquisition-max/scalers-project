"use client";

import { useActionState, useEffect, useState } from "react";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedControl } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/lib/cx";
import {
  confirmPlanChange,
  setExtraSeatsAction,
  type PlanActionState,
} from "@/app/(desk)/settings/plan/planActions";
import {
  formatKsh,
  proratedUpgradeKes,
  seatIncreaseCopy,
  seatReductionCopy,
  splitPayNote,
} from "@/lib/planPricing";
import type { OwnerPlanModel, PlanCycle, PlanSku, PublishedPlan } from "@/lib/ownerPlanLoad";

const idle: PlanActionState = { ok: false };

function numberWord(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-KE")} ${count === 1 ? one : many}`;
}

function SeatChangeNote({ model, next }: { model: OwnerPlanModel; next: number }) {
  const delta = next - model.extraSeats;
  if (delta === 0 || model.extraSeatMonthlyKes == null) return null;
  if (delta < 0) {
    const line = seatReductionCopy({
      seats: next,
      monthlyKes: model.extraSeatMonthlyKes,
      nextPeriodStart: model.nextPeriodStartLabel,
    });
    return line ? <p className="mt-3 text-body text-ink-2">{line}</p> : null;
  }
  const line =
    model.seatUnitKes != null && model.daysLeft != null && model.daysInPeriod != null
      ? seatIncreaseCopy({
          quantity: delta,
          monthlyKes: model.extraSeatMonthlyKes,
          unitKes: model.seatUnitKes,
          daysLeft: model.daysLeft,
          daysInPeriod: model.daysInPeriod,
          periodMonth: model.periodEndMonth,
        })
      : null;
  return line ? <p className="mt-3 text-body text-ink-2">{line}</p> : null;
}

function inclusionLines(plan: PublishedPlan): string[] {
  const lines = [
    numberWord(plan.minutes, "minute", "minutes"),
    numberWord(plan.seats, "seat", "seats"),
  ];
  if (plan.messageCredits != null) {
    lines.push(numberWord(plan.messageCredits, "message credit", "message credits"));
  }
  lines.push(plan.dids === 1 ? "1 number" : numberWord(plan.dids, "number", "numbers"));
  return lines;
}

export function PlanPicker({
  model,
  openSeat,
  startConfirm = false,
}: {
  model: OwnerPlanModel;
  openSeat: boolean;
  /** Dev preview only. Opens the confirm sheet on a higher plan. */
  startConfirm?: boolean;
}) {
  const upgradeSku =
    model.plans.find((plan) => plan.monthlyKes > (model.plans.find((row) => row.sku === model.currentSku)?.monthlyKes ?? 0))
      ?.sku ?? model.currentSku;
  const [sku, setSku] = useState<PlanSku | null>(startConfirm ? upgradeSku : null);
  const [cycle, setCycle] = useState<PlanCycle>(model.cycle);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    if (!startConfirm) return;
    setConfirmOpen(true);
  }, [startConfirm]);
  const [seatOpen, setSeatOpen] = useState(openSeat);
  const [seats, setSeats] = useState(model.extraSeats);
  const [seatKey, setSeatKey] = useState(() => (openSeat ? crypto.randomUUID() : ""));
  const [planState, planAction, planPending] = useActionState(confirmPlanChange, idle);
  const [seatState, seatAction, seatPending] = useActionState(setExtraSeatsAction, idle);

  const selected = model.plans.find((plan) => plan.sku === sku) || null;
  const committedSku = model.trialText ? null : model.currentSku;
  const dirty = Boolean(
    selected && (selected.sku !== committedSku || (!model.trialText && cycle !== model.cycle)),
  );
  const current = model.plans.find((plan) => plan.sku === model.currentSku) || null;
  const upgrading = Boolean(selected && current && selected.monthlyKes > current.monthlyKes);
  const downgrading = Boolean(selected && current && selected.monthlyKes < current.monthlyKes);
  const seatsOver = Boolean(selected && model.seatsUsed > selected.seats);
  const prorated =
    upgrading &&
    current &&
    selected &&
    model.dayOfPeriod != null &&
    model.daysInPeriod != null
      ? proratedUpgradeKes(current.monthlyKes, selected.monthlyKes, model.dayOfPeriod, model.daysInPeriod)
      : null;

  const fromName = current?.name || "Your plan";
  const toName = selected?.name || "this plan";
  let whenLine = "Applies now.";
  if (downgrading) {
    whenLine = model.periodEndLabel
      ? `Starts on ${model.periodEndLabel}.`
      : "Starts at the end of this period.";
  } else if (selected && !upgrading && cycle !== model.cycle) {
    whenLine = "Starts at the end of this period.";
  }
  let amountLine: string | null = null;
  if (selected && upgrading) {
    amountLine =
      prorated != null
        ? `Pay ${formatKsh(prorated)} now.`
        : "Pay the difference for the days left in this period.";
  } else if (selected && cycle === "year") {
    amountLine = `${formatKsh(selected.annualKes)} a year.`;
  } else if (selected) {
    amountLine = `${formatKsh(selected.monthlyKes)} a month.`;
  }

  return (
    <div className="mt-6 flex flex-1 flex-col">
      <SegmentedControl
        label="Billing period"
        value={cycle}
        onChange={(value) => setCycle(value === "year" ? "year" : "month")}
        items={[
          { value: "month", label: "Monthly" },
          { value: "year", label: "Annual" },
        ]}
      />

      {model.plans.length === 0 ? (
        <p className="mt-6 text-body text-ink-2">Plans show here once a package is published.</p>
      ) : (
        <fieldset className="mt-4">
          <legend className="sr-only">Plan</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {model.plans.map((plan) => {
              const picked = plan.sku === sku;
              const price = cycle === "year" ? plan.annualKes : plan.monthlyKes;
              const showCurrent = plan.sku === committedSku;
              const selected = picked && !showCurrent;
              return (
                <label
                  key={plan.sku}
                  className={cx(
                    "flex min-h-11 cursor-pointer flex-col rounded-2xl border p-4 focus-within:ring-2 focus-within:ring-brand",
                    selected ? "border-accent bg-accent-tonal" : "border-hairline bg-surface",
                  )}
                >
                  <input
                    type="radio"
                    name="plan"
                    className="sr-only"
                    checked={selected}
                    onChange={() => setSku(plan.sku)}
                  />
                  <span className="flex items-baseline gap-2">
                    <span className="text-title text-ink">{plan.name}</span>
                    {showCurrent ? <span className="text-meta text-ink-2">Current</span> : null}
                  </span>
                  <span className="mt-3 flex items-baseline gap-1">
                    <span className="text-display tabular-nums text-ink">{formatKsh(price)}</span>
                    <span className="text-meta text-ink-2">{cycle === "year" ? "/year" : "/month"}</span>
                  </span>
                  <ul className="mt-3 space-y-1 text-meta text-ink-2">
                    {inclusionLines(plan).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {cycle === "year" && plan.savingKes > 0 ? (
                    <span className="mt-3 block text-meta text-ink-2">
                      Save {formatKsh(plan.savingKes)} a year
                    </span>
                  ) : null}
                  {cycle === "year" && splitPayNote(plan.annualKes) ? (
                    <span className="mt-1 block text-meta text-ink-2">{splitPayNote(plan.annualKes)}</span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-meta text-ink-2">Prices exclude VAT.</p>
        </fieldset>
      )}

      {model.extraSeatMonthlyKes != null && !model.trialText ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => {
              setSeats(model.extraSeats);
              setSeatKey(crypto.randomUUID());
              setSeatOpen(true);
            }}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 text-start text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span>Extra seats: {model.extraSeats}</span>
          </button>
        </div>
      ) : null}

      <div className="sticky bottom-0 z-20 mt-auto border-t border-hairline bg-canvas pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="button" block disabled={!dirty} onClick={() => setConfirmOpen(true)}>
          {model.trialText ? "Choose a plan" : "Continue"}
        </Button>
      </div>

      <Sheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        dismissible={!startConfirm}
        title={upgrading ? "Upgrade" : "Change plan"}
        footer={
          <form action={planAction}>
            <input type="hidden" name="sku" value={selected?.sku || ""} />
            <input type="hidden" name="cycle" value={cycle} />
            <Button type="submit" variant="tonal" block pending={planPending} disabled={seatsOver || !selected}>
              Confirm
            </Button>
          </form>
        }
      >
        <p className="text-body text-ink">
          {fromName} to {toName}.
        </p>
        <p className="mt-1 text-body text-ink-2">{whenLine}</p>
        {amountLine && !downgrading ? (
          <p className="mt-3 text-title tabular-nums text-ink">{amountLine}</p>
        ) : null}
        {seatsOver && selected ? (
          <p className="mt-2 text-body text-ink-2">
            This plan has {selected.seats} seats. You use {model.seatsUsed}. Remove people before it starts.
          </p>
        ) : null}
        {planState.message || planState.error ? (
          <p className="mt-3 text-body text-ink">{planState.message || planState.error}</p>
        ) : null}
      </Sheet>

      <Sheet
        open={seatOpen}
        onOpenChange={setSeatOpen}
        title="Extra seats"
        description={
          model.extraSeatMonthlyKes != null ? `${formatKsh(model.extraSeatMonthlyKes)} a month each` : undefined
        }
        footer={
          <form action={seatAction} className="w-full">
            <input type="hidden" name="extra_seats" value={seats} />
            <input type="hidden" name="idempotency_key" value={seatKey} />
            <Button type="submit" variant="tonal" block pending={seatPending} disabled={seats === model.extraSeats}>
              Confirm
            </Button>
          </form>
        }
      >
        <div className="flex items-center gap-3">
          <IconButton label="Fewer seats" onClick={() => setSeats((n) => Math.max(0, n - 1))} disabled={seats <= 0}>
            <MinusIcon />
          </IconButton>
          <span className="min-w-8 text-center text-title tabular-nums text-ink">{seats}</span>
          <IconButton label="More seats" onClick={() => setSeats((n) => Math.min(100, n + 1))} disabled={seats >= 100}>
            <PlusIcon />
          </IconButton>
        </div>
        <SeatChangeNote model={model} next={seats} />
        {seatState.message || seatState.error ? (
          <p className="mt-3 text-body text-ink">{seatState.message || seatState.error}</p>
        ) : null}
      </Sheet>
    </div>
  );
}
