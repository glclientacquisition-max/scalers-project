"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import {
  saveOverviewPaymentsAction,
  saveOverviewPricesAction,
} from "@/app/(desk)/settings/overviewActions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SettingsGroup } from "@/components/settingsUi";
import { Sheet } from "@/components/ui/Sheet";
import { notify } from "@/components/ui/DeskNotice";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { PaymentsEditor } from "@/components/structured/PaymentsEditor";
import { OverviewPricesSheetBody } from "@/components/structured/OverviewPricesSheetBody";
import type { PriceToConfirm } from "@/components/structured/PriceConfirmCards";
import type { Payments } from "@/lib/payments";
import { paymentsSentence } from "@/lib/payments";

export type OverviewDataCheck =
  | { kind: "link"; href: string; label: string; detail: string }
  | {
      kind: "prices";
      href: string;
      label: string;
      detail: string;
      items: PriceToConfirm[];
    }
  | {
      kind: "payments";
      href: string;
      label: string;
      detail: string;
      payments: Payments;
      legacyText: string;
    };

type OpenSheet = null | { kind: "prices"; items: PriceToConfirm[]; href: string } | { kind: "payments"; payments: Payments; legacyText: string; href: string };

function paymentsUnchanged(a: Payments, b: Payments): boolean {
  return paymentsSentence(a) === paymentsSentence(b) && JSON.stringify(a) === JSON.stringify(b);
}

/** Overview: owner "Is this right?" checks open a sheet and save on the same paths as Settings. */
export function OverviewDataChecksCard({
  checks,
  canEdit = true,
}: {
  checks: OverviewDataCheck[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSheet>(null);
  const [doneKeys, setDoneKeys] = useState<string[]>([]);

  const visible = useMemo(
    () => checks.filter((c) => !doneKeys.includes(checkKey(c))),
    [checks, doneKeys]
  );

  if (!visible.length) return null;

  function checkKey(c: OverviewDataCheck): string {
    if (c.kind === "link") return `link:${c.href}`;
    if (c.kind === "prices") return `prices:${c.items.map((i) => `${i.kind}:${i.id || i.name}`).join(",")}`;
    return "payments";
  }

  function openCheck(c: OverviewDataCheck) {
    if (c.kind === "link") return;
    if (!canEdit) return;
    if (c.kind === "prices") setOpen({ kind: "prices", items: c.items, href: c.href });
    else setOpen({ kind: "payments", payments: c.payments, legacyText: c.legacyText, href: c.href });
  }

  function finish(key: string) {
    setDoneKeys((d) => [...d, key]);
    setOpen(null);
    router.refresh();
  }

  return (
    <>
      <SettingsGroup title="Is this right?">
        {visible.map((c) => {
          const key = checkKey(c);
          const rowClass = `flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${deskShiftClass}`;
          if (c.kind === "link") {
            return (
              <Link key={key} href={c.href} className={rowClass}>
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">{c.label}</span>
                  <span className="block text-meta text-ink-2">{c.detail}</span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
              </Link>
            );
          }
          return (
            <button key={key} type="button" className={rowClass} onClick={() => openCheck(c)} disabled={!canEdit}>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">{c.label}</span>
                <span className="block text-meta text-ink-2">{c.detail}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
            </button>
          );
        })}
      </SettingsGroup>

      {open?.kind === "prices" ? (
        <OverviewPricesSheet
          items={open.items}
          catalogHref={open.href}
          onClose={() => setOpen(null)}
          onSaved={() => finish(`prices:${open.items.map((i) => `${i.kind}:${i.id || i.name}`).join(",")}`)}
          save={saveOverviewPricesAction}
        />
      ) : null}

      {open?.kind === "payments" ? (
        <OverviewPaymentsSheet
          initial={open.payments}
          legacyText={open.legacyText}
          policiesHref={open.href}
          onClose={() => setOpen(null)}
          onSaved={() => finish("payments")}
          save={saveOverviewPaymentsAction}
        />
      ) : null}
    </>
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
  pending?: boolean;
  onClose: () => void;
  onSaved: () => void;
  save: typeof saveOverviewPaymentsAction;
}) {
  const [payments, setPayments] = useState(initial);
  const [payPending, startPay] = useTransition();
  const unchanged = paymentsUnchanged(payments, initial);

  function submit() {
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
