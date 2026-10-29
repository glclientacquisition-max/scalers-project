"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Button, ButtonLink } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedControl } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { UsageBar } from "@/components/plan/UsageBar";
import {
  confirmPlanChange,
  setExtraSeatsAction,
  type PlanActionState,
} from "@/app/(desk)/settings/plan/planActions";
import { MINUTES_WARN_SHARE, meterTone } from "@/lib/planEntry";
import {
  allowanceChanges,
  allowanceLines,
  formatKsh,
  planDowngradeChanges,
  planUpgradeCopy,
  proratedUpgradeKes,
  seatBlockCopy,
  seatIncreaseCopy,
  seatReductionCopy,
  splitPayNote,
} from "@/lib/planPricing";
import type { OwnerPlanModel, PlanCycle, PlanSku, PublishedPlan } from "@/lib/ownerPlanLoad";
import { deskConfirmHaptic } from "@/lib/deskFeel";

const idle: PlanActionState = { ok: false };
const TEAM_HREF = "/settings?tab=train&panel=team";

function per(cycle: PlanCycle): string {
  return cycle === "year" ? "a year" : "a month";
}

function priceFor(plan: PublishedPlan, cycle: PlanCycle): number {
  return cycle === "year" ? plan.annualKes : plan.monthlyKes;
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

function CurrentPlanCard({ model, plan }: { model: OwnerPlanModel; plan: PublishedPlan }) {
  const renew = model.nextPeriodStartLabel || model.periodEndLabel;
  const included = plan.minutes;
  const tone = meterTone(model.minutesUsed, included, MINUTES_WARN_SHARE);
  return (
    <section aria-label="Your plan" className="rounded-2xl border border-hairline bg-surface p-4">
      <h2 className="text-title text-ink">{plan.name}</h2>
      <p className="mt-0.5 text-body tabular-nums text-ink-2">
        {formatKsh(priceFor(plan, model.cycle))} {per(model.cycle)}
        {renew ? ` · Renews ${renew}` : ""}
      </p>
      {included > 0 ? (
        <>
          <p className={`mt-3 text-meta tabular-nums ${tone === "ok" ? "text-ink-2" : "font-medium text-warn"}`}>
            {model.minutesUsed.toLocaleString("en-KE")} of {included.toLocaleString("en-KE")} minutes used
          </p>
          <UsageBar used={model.minutesUsed} included={included} tone={tone} label="Minutes used" thin className="mt-2" />
        </>
      ) : null}
    </section>
  );
}

function PlanCard({
  plan,
  cycle,
  action,
}: {
  plan: PublishedPlan;
  cycle: PlanCycle;
  action: ReactNode;
}) {
  const lines = allowanceLines(plan);
  const monthlyOfAnnual = Math.round(plan.annualKes / 12);
  return (
    <li className="flex flex-col rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 lg:flex-col lg:items-start lg:gap-1">
        <h3 className="text-title text-ink">{plan.name}</h3>
        <p className="text-body font-semibold tabular-nums text-ink lg:text-title">
          {formatKsh(cycle === "year" ? monthlyOfAnnual : plan.monthlyKes)}{" "}
          <span className="text-meta font-normal text-ink-2">a month</span>
        </p>
      </div>
      {cycle === "year" ? (
        <p className="mt-1 text-meta tabular-nums text-ink-2">
          Billed {formatKsh(plan.annualKes)} a year.
          {plan.savingKes > 0 ? ` Save ${formatKsh(plan.savingKes)}.` : ""}
        </p>
      ) : null}
      <p className="mt-2 text-meta tabular-nums text-ink-2 lg:hidden">{lines.join(" · ")}</p>
      <ul className="mt-3 hidden space-y-1 text-meta tabular-nums text-ink-2 lg:block">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-auto pt-3">{action}</div>
    </li>
  );
}

export function PlanPicker({
  model,
  openSeat,
  startConfirm = null,
}: {
  model: OwnerPlanModel;
  openSeat: boolean;
  /** Dev preview only. Opens the confirm sheet on this plan. */
  startConfirm?: PlanSku | null;
}) {
  const router = useRouter();
  const trial = Boolean(model.trialText);
  const [cycle, setCycle] = useState<PlanCycle>(model.cycle);
  const [sku, setSku] = useState<PlanSku | null>(startConfirm);
  const [confirmOpen, setConfirmOpen] = useState(Boolean(startConfirm));
  const [seatOpen, setSeatOpen] = useState(openSeat);
  const [seats, setSeats] = useState(model.extraSeats);
  const [seatKey, setSeatKey] = useState(() => (openSeat ? crypto.randomUUID() : ""));
  const [planKey, setPlanKey] = useState(() => (startConfirm ? crypto.randomUUID() : ""));
  const [planState, planAction, planPending] = useActionState(confirmPlanChange, idle);
  const [seatState, seatAction, seatPending] = useActionState(setExtraSeatsAction, idle);

  useEffect(() => {
    if (!planState.ok) return;
    setConfirmOpen(false);
    router.refresh();
  }, [planState.ok, router]);

  useEffect(() => {
    if (!seatState.ok) return;
    setSeatOpen(false);
    router.refresh();
  }, [seatState.ok, router]);

  const pinned = trial ? null : model.pinned;
  const selected = model.plans.find((plan) => plan.sku === sku) || null;
  const publishedCurrent = model.plans.find((plan) => plan.sku === model.currentSku) || null;
  const onPublished =
    Boolean(pinned && publishedCurrent && pinned.versionId && pinned.versionId === publishedCurrent.versionId);
  const dids = model.plans[0]?.dids ?? 1;

  function open(next: PlanSku) {
    setSku(next);
    setPlanKey(crypto.randomUUID());
    setConfirmOpen(true);
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {pinned ? <CurrentPlanCard model={model} plan={pinned} /> : null}

      <SegmentedControl
        label="Billing period"
        value={cycle}
        onChange={(value) => setCycle(value === "year" ? "year" : "month")}
        className="self-start"
        items={[
          { value: "month", label: "Monthly" },
          { value: "year", label: "Annual" },
        ]}
      />

      {model.plans.length === 0 ? (
        <p className="text-body text-ink-2">Plans show here once a package is published.</p>
      ) : (
        <div>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {model.plans.map((plan) => {
              const isCurrent = onPublished && publishedCurrent?.sku === plan.sku;
              let action: ReactNode;
              if (isCurrent && cycle === model.cycle) {
                action = (
                  <p className="flex h-11 items-center justify-center rounded-xl bg-surface-2 text-body font-medium text-ink-2">
                    Your plan
                  </p>
                );
              } else {
                const label = trial
                  ? `Choose ${plan.name}`
                  : isCurrent
                    ? `Switch to ${cycle === "year" ? "annual" : "monthly"}`
                    : `Switch to ${plan.name}`;
                action = (
                  <Button type="button" variant="tonal" block onClick={() => open(plan.sku)}>
                    {label}
                  </Button>
                );
              }
              return <PlanCard key={plan.sku} plan={plan} cycle={cycle} action={action} />;
            })}
          </ul>
          <p className="mt-3 text-meta text-ink-2">
            Every plan includes {dids === 1 ? "1 number" : `${dids} numbers`}. Prices exclude VAT.
          </p>
        </div>
      )}

      {model.extraSeatMonthlyKes != null && !trial ? (
        <button
          type="button"
          onClick={() => {
            setSeats(model.extraSeats);
            setSeatKey(crypto.randomUUID());
            setSeatOpen(true);
          }}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 text-start text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span>Extra seats</span>
          <span className="tabular-nums text-ink-2">{model.extraSeats}</span>
        </button>
      ) : null}

      <ConfirmSheet
        model={model}
        current={pinned}
        selected={selected}
        cycle={cycle}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        dismissible={!startConfirm}
        action={planAction}
        pending={planPending}
        state={planState}
        idempotencyKey={planKey}
      />

      <Sheet
        open={seatOpen}
        onOpenChange={setSeatOpen}
        title="Extra seats"
        description={
          model.extraSeatMonthlyKes != null ? `${formatKsh(model.extraSeatMonthlyKes)} a month each` : undefined
        }
        footer={
          <form
            action={seatAction}
            className="w-full"
            onSubmit={() => {
              deskConfirmHaptic();
            }}
          >
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

function ConfirmSheet({
  model,
  current,
  selected,
  cycle,
  open,
  onOpenChange,
  dismissible,
  action,
  pending,
  state,
  idempotencyKey,
}: {
  model: OwnerPlanModel;
  current: PublishedPlan | null;
  selected: PublishedPlan | null;
  cycle: PlanCycle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissible: boolean;
  action: (payload: FormData) => void;
  pending: boolean;
  state: PlanActionState;
  idempotencyKey: string;
}) {
  const start = model.nextPeriodStartLabel || model.periodEndLabel;
  const sameCycle = cycle === model.cycle;
  const sameOffer = Boolean(selected && current && selected.versionId && selected.versionId === current.versionId);
  const newPrice = selected ? priceFor(selected, cycle) : 0;
  const oldPrice = current ? priceFor(current, model.cycle) : 0;
  const upgrading = Boolean(selected && current && sameCycle && newPrice > oldPrice);
  const seatBlock = selected && current && selected.seats < current.seats ? seatBlockCopy(model.seatsUsed, selected.seats) : null;

  let lead: string | null = null;
  let detail: string | null = null;
  if (selected && !current) {
    lead = `${formatKsh(newPrice)} ${per(cycle)}.`;
  } else if (selected && current && upgrading) {
    const due =
      model.dayOfPeriod != null && model.daysInPeriod != null
        ? proratedUpgradeKes(oldPrice, newPrice, model.dayOfPeriod, model.daysInPeriod)
        : null;
    lead =
      due != null
        ? planUpgradeCopy({
            dueKes: due,
            laterKes: newPrice,
            cycle,
            periodMonth: cycle === "month" ? model.periodEndMonth : null,
            nextPeriodStart: start,
          })
        : `${formatKsh(newPrice)} ${per(cycle)}. You pay the difference for the days left in this period.`;
  } else if (selected && current) {
    const name = sameOffer ? (cycle === "year" ? "Annual" : "Monthly") : selected.name;
    lead = `No charge today. ${name} starts ${start ? start : "at the end of this period"}.`;
    detail = sameOffer
      ? `Then ${formatKsh(newPrice)} ${per(cycle)}.`
      : planDowngradeChanges(current, selected, start);
    if (!sameOffer && !sameCycle) {
      detail = [detail, `Then ${formatKsh(newPrice)} ${per(cycle)}.`].filter(Boolean).join(" ");
    }
  }
  const changes = upgrading && current && selected ? allowanceChanges(current, selected) : [];
  const split = selected && cycle === "year" ? splitPayNote(selected.annualKes) : null;
  const title = selected
    ? current
      ? sameOffer
        ? `Switch to ${cycle === "year" ? "annual" : "monthly"}`
        : `Switch to ${selected.name}`
      : `Choose ${selected.name}`
    : "Change plan";

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      dismissible={dismissible}
      title={title}
      footer={
        seatBlock ? (
          <ButtonLink href={TEAM_HREF} variant="tonal" block>
            Team
          </ButtonLink>
        ) : (
          <form
            action={action}
            className="w-full"
            onSubmit={() => {
              deskConfirmHaptic();
            }}
          >
            <input type="hidden" name="sku" value={selected?.sku || ""} />
            <input type="hidden" name="cycle" value={cycle} />
            <input type="hidden" name="idempotency_key" value={idempotencyKey} />
            <Button type="submit" variant="tonal" block pending={pending} disabled={!selected}>
              Confirm
            </Button>
          </form>
        )
      }
    >
      {seatBlock && selected ? (
        <>
          <p className="text-body font-medium text-warn">{seatBlock}</p>
          <p className="mt-1 text-body text-ink-2">
            {selected.name} has {selected.seats} seats. You use {model.seatsUsed}.
          </p>
        </>
      ) : (
        <>
          {lead ? <p className="text-body tabular-nums text-ink">{lead}</p> : null}
          {detail ? <p className="mt-2 text-body tabular-nums text-ink-2">{detail}</p> : null}
          {changes.length > 0 ? (
            <dl className="mt-3 divide-y divide-hairline rounded-xl border border-hairline">
              {changes.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2 text-body">
                  <dt className="text-ink-2">{row.label}</dt>
                  <dd className="tabular-nums text-ink">
                    {row.from} → {row.to}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {split ? <p className="mt-3 text-meta text-ink-2">{split}</p> : null}
        </>
      )}
      {state.message || state.error ? (
        <p className="mt-3 text-body text-ink" role={state.ok ? "status" : "alert"}>
          {state.message || state.error}
        </p>
      ) : null}
    </Sheet>
  );
}
