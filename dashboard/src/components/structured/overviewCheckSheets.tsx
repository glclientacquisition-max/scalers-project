"use client";

import { useMemo, useState, useTransition } from "react";
import {
  saveOverviewHoursAction,
  saveOverviewPaymentsAction,
  saveOverviewPricesAction,
} from "@/app/(desk)/settings/overviewActions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { notify } from "@/components/ui/DeskNotice";
import { PaymentsEditor } from "@/components/structured/PaymentsEditor";
import { OverviewPricesSheetBody } from "@/components/structured/OverviewPricesSheetBody";
import type { PriceToConfirm } from "@/components/structured/PriceConfirmCards";
import type { OverviewDataCheck } from "@/components/structured/OverviewDataChecksCard";
import type { Payments } from "@/lib/payments";
import { paymentsSentence } from "@/lib/payments";
import { formatHoursForOwner, type HoursSchedule } from "@/lib/hoursSchedule";
import { checkKey } from "@/lib/overviewDataChecks";

export type OpenOverviewCheck =
  | null
  | { kind: "prices"; items: PriceToConfirm[]; href: string }
  | { kind: "payments"; payments: Payments; legacyText: string; href: string }
  | { kind: "hours"; schedule: HoursSchedule; href: string };

function paymentsUnchanged(a: Payments, b: Payments): boolean {
  return paymentsSentence(a) === paymentsSentence(b) && JSON.stringify(a) === JSON.stringify(b);
}

export function openSheetFromCheck(c: OverviewDataCheck): OpenOverviewCheck {
  if (c.kind === "link") return null;
  if (c.kind === "prices") return { kind: "prices", items: c.items, href: c.href };
  if (c.kind === "payments") {
    return { kind: "payments", payments: c.payments, legacyText: c.legacyText, href: c.href };
  }
  if (c.kind === "hours") return { kind: "hours", schedule: c.schedule, href: c.href };
  return null;
}

export function OverviewCheckSheetHost({
  open,
  onClose,
  onSaved,
  canEdit = true,
}: {
  open: OpenOverviewCheck;
  onClose: () => void;
  onSaved: (key: string) => void;
  canEdit?: boolean;
}) {
  if (!open) return null;
  if (open.kind === "prices") {
    return (
      <OverviewPricesSheet
        items={open.items}
        catalogHref={open.href}
        onClose={onClose}
        onSaved={() => onSaved(checkKey({ kind: "prices", href: open.href, label: "", detail: "", items: open.items }))}
        save={saveOverviewPricesAction}
      />
    );
  }
  if (open.kind === "payments") {
    return (
      <OverviewPaymentsSheet
        initial={open.payments}
        legacyText={open.legacyText}
        policiesHref={open.href}
        onClose={onClose}
        onSaved={() => onSaved("payments")}
        save={saveOverviewPaymentsAction}
      />
    );
  }
  return (
    <OverviewHoursSheet
      schedule={open.schedule}
      hoursHref={open.href}
      onClose={onClose}
      onSaved={() => onSaved("hours")}
      save={saveOverviewHoursAction}
      canEdit={canEdit}
    />
  );
}

function OverviewPricesSheet({
  items,
  catalogHref,
  onClose,
  onSaved,
  save,
}: {
  items: PriceToConfirm[];
  catalogHref: string;
  onClose: () => void;
  onSaved: () => void;
  save: typeof saveOverviewPricesAction;
}) {
  const [draft, setDraft] = useState(items);
  const [pricePending, startPrices] = useTransition();
  const unchanged = useMemo(
    () =>
      draft.length === items.length &&
      draft.every((row, i) => JSON.stringify(row.pricing) === JSON.stringify(items[i].pricing)),
    [draft, items]
  );

  function submit() {
    if (unchanged && items.every((row) => row.pricing.confirmed)) return;
    startPrices(async () => {
      const payload = draft.map((row) => ({
        kind: row.kind,
        id: row.id ?? null,
        name: row.name,
        pricing: row.pricing,
      }));
      const res = await save(payload);
      notify(res.ok ? res.message : res.error);
      if (res.ok) onSaved();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={items.length === 1 ? "Check price" : `Check ${items.length} prices`}
      description="Imported from your notes. Edit if needed, then save."
      size="lg"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ButtonLink href={catalogHref} variant="ghost" size="sm" className="self-start">
            Open full Catalogue
          </ButtonLink>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" pending={pricePending} onClick={submit}>
              {unchanged ? "Looks right, save" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <OverviewPricesSheetBody items={draft} onChange={setDraft} />
    </Sheet>
  );
}

function OverviewPaymentsSheet({
  initial,
  legacyText,
  policiesHref,
  onClose,
  onSaved,
  save,
}: {
  initial: Payments;
  legacyText: string;
  policiesHref: string;
  onClose: () => void;
  onSaved: () => void;
  save: typeof saveOverviewPaymentsAction;
}) {
  const [payments, setPayments] = useState(initial);
  const [payPending, startPay] = useTransition();
  const unchanged = paymentsUnchanged(payments, initial);

  function submit() {
    if (unchanged && initial.confirmed) return;
    startPay(async () => {
      const res = await save(payments);
      notify(res.ok ? res.message : res.error);
      if (res.ok) onSaved();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Check how customers pay"
      description="Imported from your payment notes. Edit if needed, then save."
      size="lg"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ButtonLink href={policiesHref} variant="ghost" size="sm" className="self-start">
            Open full Policies
          </ButtonLink>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" pending={payPending} onClick={submit}>
              {unchanged ? "Looks right, save" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <PaymentsEditor value={payments} legacyText={legacyText} onChange={setPayments} canEdit />
    </Sheet>
  );
}

function OverviewHoursSheet({
  schedule,
  hoursHref,
  onClose,
  onSaved,
  save,
  canEdit,
}: {
  schedule: HoursSchedule;
  hoursHref: string;
  onClose: () => void;
  onSaved: () => void;
  save: typeof saveOverviewHoursAction;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const summary = formatHoursForOwner(schedule);

  function submit() {
    start(async () => {
      const res = await save(schedule);
      notify(res.ok ? res.message : res.error);
      if (res.ok) onSaved();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Check opening hours"
      description={
        canEdit
          ? "Imported from your notes. Edit on Hours if needed, then save."
          : "Imported from your notes."
      }
      size="lg"
      footer={
        canEdit ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ButtonLink href={hoursHref} variant="ghost" size="sm" className="self-start">
              Open full Hours
            </ButtonLink>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" pending={pending} onClick={submit}>
                Looks right, save
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <ButtonLink href={hoursHref} variant="primary" size="sm" onClick={onClose}>
              Hours
            </ButtonLink>
          </div>
        )
      }
    >
      {summary ? <p className="text-body text-ink">{summary}</p> : null}
    </Sheet>
  );
}
