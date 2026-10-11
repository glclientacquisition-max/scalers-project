"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { notify } from "@/components/ui/DeskNotice";
import { SettingsGroup } from "@/components/settingsUi";
import {
  PAYMENT_METHODS,
  PAYMENT_TIMING,
  emptyPayments,
  validatePayments,
  type PaymentMethod,
  type PaymentTiming,
  type Payments,
} from "@/lib/structuredData";
import type { StructuredResult } from "@/app/(desk)/settings/structuredActions";
import { Chips } from "./Chips";

const rowClass = "space-y-3 px-4 py-3";

/**
 * How customers pay, as typed facts: methods, M-Pesa numbers, when they pay, deposit.
 * A value read from old text shows "Is this right?" until the owner saves it.
 */
export function PaymentsEditor({
  initial,
  canEdit,
  save,
}: {
  initial: Payments | null;
  canEdit: boolean;
  save: (p: Payments) => Promise<StructuredResult>;
}) {
  const [p, setP] = useState<Payments>(initial ?? emptyPayments());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [confirmed, setConfirmed] = useState(initial ? initial.confirmed : true);
  const has = (m: PaymentMethod) => p.methods.includes(m);
  const depositOn = p.deposit_percent != null;

  function submit() {
    const local = validatePayments(p);
    setErrors(local);
    if (Object.keys(local).length) return;
    start(async () => {
      const res = await save(p);
      if (res.ok) {
        setConfirmed(true);
        setErrors({});
      } else if (res.fields) setErrors(res.fields);
      notify(res.ok ? res.message : res.error);
    });
  }

  return (
    <SettingsGroup title="How customers pay">
      {!confirmed ? (
        <div className="space-y-1 bg-accent-tonal px-4 py-3" role="note">
          <p className="text-body font-medium text-ink">Is this right?</p>
          <p className="text-meta text-ink-2">We read this from your payment notes. Check it, then save.</p>
        </div>
      ) : null}
      <div className={rowClass}>
        <p id="pay-methods-label" className="text-meta font-medium text-ink">Ways to pay</p>
        <Chips<PaymentMethod>
          label="Ways to pay"
          multiple
          options={PAYMENT_METHODS}
          value={p.methods}
          onChange={(methods) => canEdit && setP({ ...p, methods })}
        />
      </div>
      {has("mpesa_till") ? (
        <div className={rowClass}>
          <Field id="pay-till" label="M-Pesa Till number" error={errors.mpesa_till} hint="5 to 7 digits">
            {(a) => (
              <Input {...a} inputMode="numeric" autoComplete="off" maxLength={7} disabled={!canEdit} value={p.mpesa_till ?? ""}
                onChange={(e) => setP({ ...p, mpesa_till: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 123456" />
            )}
          </Field>
        </div>
      ) : null}
      {has("mpesa_paybill") ? (
        <div className={`${rowClass} sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0`}>
          <Field id="pay-paybill" label="Paybill number" error={errors.paybill} hint="5 to 7 digits">
            {(a) => (
              <Input {...a} inputMode="numeric" autoComplete="off" maxLength={7} disabled={!canEdit}
                value={p.mpesa_paybill?.business_no ?? ""}
                onChange={(e) => setP({ ...p, mpesa_paybill: { business_no: e.target.value.replace(/\D/g, ""), account: p.mpesa_paybill?.account ?? null } })}
                placeholder="e.g. 247247" />
            )}
          </Field>
          <Field id="pay-account" label="Account (optional)" error={errors.paybill_account}>
            {(a) => (
              <Input {...a} autoComplete="off" maxLength={40} disabled={!canEdit} value={p.mpesa_paybill?.account ?? ""}
                onChange={(e) => setP({ ...p, mpesa_paybill: { business_no: p.mpesa_paybill?.business_no ?? "", account: e.target.value } })}
                placeholder="e.g. your phone number" />
            )}
          </Field>
        </div>
      ) : null}
      <div className={rowClass}>
        <p className="text-meta font-medium text-ink">When customers pay</p>
        <Chips<PaymentTiming>
          label="When customers pay"
          options={PAYMENT_TIMING}
          value={p.timing ? [p.timing] : []}
          onChange={(v) => canEdit && setP({ ...p, timing: v[0] ?? null })}
        />
      </div>
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
        <div className="min-w-0">
          <p className="text-body text-ink">Deposit</p>
          <p className="text-meta text-ink-2">A part paid before you start or deliver.</p>
        </div>
        <Switch label="Ask for a deposit" checked={depositOn} disabled={!canEdit}
          onCheckedChange={(on) => setP({ ...p, deposit_percent: on ? p.deposit_percent ?? 30 : null })} />
      </div>
      {depositOn ? (
        <div className={rowClass}>
          <Field id="pay-deposit" label="Deposit (%)" error={errors.deposit_percent}>
            {(a) => (
              <Input {...a} inputMode="numeric" maxLength={3} className="max-w-28" disabled={!canEdit} value={String(p.deposit_percent ?? "")}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setP({ ...p, deposit_percent: v ? Number(v) : 0 });
                }} />
            )}
          </Field>
        </div>
      ) : null}
      {canEdit ? (
        <div className="flex justify-end px-4 py-3">
          <Button variant="tonal" size="md" pending={pending} onClick={submit}>
            {confirmed ? "Save payments" : "Yes, save payments"}
          </Button>
        </div>
      ) : null}
    </SettingsGroup>
  );
}
