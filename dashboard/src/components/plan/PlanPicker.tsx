"use client";

import { useActionState, useEffect, useState } from "react";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedControl } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import {
  confirmPlanChange,
  confirmSeatPurchase,
  type PlanActionState,
} from "@/app/(desk)/settings/plan/planActions";
import {
  EXTRA_SEAT_MONTHLY_KES,
  formatKsh,
  proratedUpgradeKes,
  splitPayNote,
} from "@/lib/planPricing";
import type { OwnerPlanModel, PlanCycle, PlanSku } from "@/lib/ownerPlanLoad";

const idle: PlanActionState = { ok: false };

function numberWord(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-KE")} ${count === 1 ? one : many}`;
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
  const [sku, setSku] = useState<PlanSku | null>(startConfirm ? upgradeSku : model.currentSku);
  const [cycle, setCycle] = useState<PlanCycle>(model.cycle);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    if (!startConfirm) return;
    setConfirmOpen(true);
  }, [startConfirm]);
  const [seatOpen, setSeatOpen] = useState(openSeat);
  const [seats, setSeats] = useState(1);
  const [planState, planAction, planPending] = useActionState(confirmPlanChange, idle);
  const [seatState, seatAction, seatPending] = useActionState(confirmSeatPurchase, idle);

  const selected = model.plans.find((plan) => plan.sku === sku) || null;
  const dirty = Boolean(selected && (selected.sku !== model.currentSku || cycle !== model.cycle));
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

  let confirmLine = "Plan changes open soon.";
  if (selected && upgrading) {
    confirmLine =
      prorated != null
        ? `Pay ${formatKsh(prorated)} now.`
        : "Pay the difference for the days left in this period.";
  } else if (selected && downgrading) {
    confirmLine = model.periodEndLabel
      ? `Starts on ${model.periodEndLabel}.`
      : "Starts at the end of this period.";
  } else if (selected && cycle === "year") {
    confirmLine = `${formatKsh(selected.annualKes)} a year.`;
  } else if (selected) {
    confirmLine = `${formatKsh(selected.monthlyKes)} a month, ex VAT.`;
  }

  return (
    <div className="mt-6">
      {model.trialText ? <p className="text-body text-ink">{model.trialText}</p> : null}
      <SegmentedControl
        className="mt-4"
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
        <fieldset className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface">
          <legend className="sr-only">Plan</legend>
          {model.plans.map((plan) => {
            const active = plan.sku === sku;
            const price =
              cycle === "year"
                ? `${formatKsh(plan.annualKes)} a year`
                : `${formatKsh(plan.monthlyKes)} a month, ex VAT`;
            const facts = [
              numberWord(plan.minutes, "minute", "minutes"),
              numberWord(plan.seats, "seat", "seats"),
              plan.messageCredits != null
                ? numberWord(plan.messageCredits, "message credit", "message credits")
                : null,
              plan.dids === 1 ? "1 number" : numberWord(plan.dids, "number", "numbers"),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <label
                key={plan.sku}
                className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-hairline px-4 py-3 last:border-b-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand"
              >
                <input
                  type="radio"
                  name="plan"
                  className="mt-1 h-5 w-5"
                  checked={active}
                  onChange={() => setSku(plan.sku)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3">
                    <span className="text-body font-medium text-ink">{plan.name}</span>
                    {plan.sku === model.currentSku ? (
                      <span className="text-meta text-ink-2">Current</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-body tabular-nums text-ink">{price}</span>
                  <span className="mt-0.5 block text-meta text-ink-2">{facts}</span>
                  {cycle === "year" ? (
                    <span className="mt-0.5 block text-meta text-ink-2">
                      Save {formatKsh(plan.savingKes)} a year
                    </span>
                  ) : null}
                  {cycle === "year" && splitPayNote(plan.annualKes) ? (
                    <span className="mt-0.5 block text-meta text-ink-2">{splitPayNote(plan.annualKes)}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="mt-6">
        <Button type="button" variant="ghost" onClick={() => setSeatOpen(true)}>
          Extra seat, {formatKsh(EXTRA_SEAT_MONTHLY_KES)} a month
        </Button>
      </div>

      <div className="sticky bottom-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom))] z-20 -mx-4 mt-8 border-t border-hairline bg-surface px-4 py-3 md:static md:bottom-auto md:mx-0 md:border-0 md:bg-transparent md:px-0">
        <Button type="button" disabled={!dirty} onClick={() => setConfirmOpen(true)}>
          Continue
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
            <Button type="submit" variant="tonal" pending={planPending} disabled={seatsOver || !selected}>
              Confirm
            </Button>
          </form>
        }
      >
        <p className="text-body text-ink">{confirmLine}</p>
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
        title="Extra seat"
        description={`${formatKsh(EXTRA_SEAT_MONTHLY_KES)} a month each`}
        footer={
          <form action={seatAction}>
            <input type="hidden" name="quantity" value={seats} />
            <Button type="submit" variant="tonal" pending={seatPending}>
              Confirm
            </Button>
          </form>
        }
      >
        <div className="flex items-center gap-3">
          <IconButton label="Fewer seats" onClick={() => setSeats((n) => Math.max(1, n - 1))} disabled={seats <= 1}>
            <MinusIcon />
          </IconButton>
          <span className="min-w-8 text-center text-title tabular-nums text-ink">{seats}</span>
          <IconButton label="More seats" onClick={() => setSeats((n) => Math.min(20, n + 1))} disabled={seats >= 20}>
            <PlusIcon />
          </IconButton>
        </div>
        {seatState.message || seatState.error ? (
          <p className="mt-3 text-body text-ink">{seatState.message || seatState.error}</p>
        ) : null}
      </Sheet>
    </div>
  );
}
