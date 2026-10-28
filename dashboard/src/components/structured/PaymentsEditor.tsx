"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { SettingsGroup } from "@/components/settingsUi";
import {
  CARD_WHERE,
  KENYA_BANKS,
  PAYBILL_ACCOUNT_MODES,
  PAYMENT_METHODS,
  PAYMENT_TIMING,
  NOTE_MAX,
  emptyPayments,
  kenyanMobileDisplay,
  kenyanMobileE164,
  labelOfMethod,
  methodSummary,
  paymentsSentence,
  validatePayments,
  type CardWhere,
  type PaybillAccountMode,
  type PaymentMethod,
  type PaymentTiming,
  type Payments,
} from "@/lib/payments";
import { AddRow, CallersHear, CheckList, OpenRow } from "./PickList";
import { ownerPolicySummary } from "@/lib/ownerPolicyCopy";

/** Error keys that belong to each method's drawer. */
const METHOD_ERRORS: Record<PaymentMethod, string[]> = {
  mpesa_till: ["mpesa_till"],
  mpesa_paybill: ["paybill", "paybill_account"],
  pochi: ["pochi_phone"],
  mpesa_send: ["send_phone"],
  airtel: ["airtel", "airtel_till", "airtel_phone"],
  bank: ["bank_name", "bank_account_name", "bank_account_no"],
  card: [],
  cash: [],
  cheque: [],
};

const NO_FIELDS: PaymentMethod[] = ["cash", "cheque"];

function withMethod(p: Payments, m: PaymentMethod): Payments {
  const next = { ...p, methods: p.methods.includes(m) ? p.methods : [...p.methods, m] };
  if (m === "mpesa_paybill" && !next.mpesa_paybill) next.mpesa_paybill = { business_no: "", account_mode: "fixed", account: null };
  if (m === "pochi" && !next.pochi) next.pochi = { phone: "" };
  if (m === "mpesa_send" && !next.mpesa_send) next.mpesa_send = { phone: "", name: null };
  if (m === "airtel" && !next.airtel) next.airtel = { till: null, phone: null };
  if (m === "bank" && !next.bank) next.bank = { bank_name: "", account_name: "", account_no: "" };
  if (m === "card" && !next.card) next.card = { where: [] };
  return next;
}

/** Phone input that shows 0712 345 678 for a stored +254 number and keeps what is typed. */
function phoneValue(v: string | null | undefined): string {
  const e = kenyanMobileE164(v);
  return e && String(v).startsWith("+") ? kenyanMobileDisplay(e) : String(v ?? "");
}

/**
 * How customers pay. Ways to pay are a grouped list; each opens a bottom drawer with only
 * that method's fields. "When customers pay" allows several answers. A free note covers
 * what fields can't. Controlled: the Settings form owns the value and saves it with the page.
 */
export function PaymentsEditor({
  value,
  legacyText,
  quoteSource = true,
  onChange,
  errors = {},
  canEdit = true,
}: {
  value: Payments | null;
  /** Old free-text payment line, shown when the typed value was read from it. */
  legacyText?: string;
  /** False when the old line is starter text shown elsewhere, so it is not quoted twice. */
  quoteSource?: boolean;
  onChange: (next: Payments) => void;
  errors?: Record<string, string>;
  canEdit?: boolean;
}) {
  const p = value ?? emptyPayments();
  const [sheet, setSheet] = useState<null | "pick" | PaymentMethod | "timing">(null);
  const [draft, setDraft] = useState<Payments>(p);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const unconfirmed = Boolean(value && value.source === "parsed" && !value.confirmed);
  const source = quoteSource ? ownerPolicySummary(legacyText || value?.parsed_from) : null;
  const available = PAYMENT_METHODS.filter((o) => !p.methods.includes(o.id));

  function open(which: NonNullable<typeof sheet>) {
    setDraft(typeof which === "string" && which !== "pick" && which !== "timing" ? withMethod(p, which) : p);
    setDraftErrors({});
    setSheet(which);
  }

  function commit(next: Payments, keys: string[]) {
    const all = validatePayments(next);
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k)));
    setDraftErrors(mine);
    if (Object.keys(mine).length) return;
    onChange({ ...next, source: "owner", confirmed: true });
    setSheet(null);
  }

  function remove(m: PaymentMethod) {
    onChange({ ...p, methods: p.methods.filter((x) => x !== m), source: "owner", confirmed: true });
    setSheet(null);
  }

  const editing = sheet && sheet !== "pick" && sheet !== "timing" ? sheet : null;
  const timingSummary = p.timings
    .map((t) => (t === "deposit_then_balance" && p.deposit_percent ? `${p.deposit_percent}% deposit, then balance` : PAYMENT_TIMING.find((o) => o.id === t)?.label))
    .join(", ");
  const timingError = errors.deposit_percent || errors.timings;

  return (
    <div id="payments" className="scroll-mt-24 space-y-6" data-payments-editor="">
      <SettingsGroup title="How customers pay">
        {unconfirmed ? (
          <div className="space-y-2 bg-accent-tonal px-4 py-3" role="note">
            <p className="text-body font-medium text-ink">Is this right?</p>
            <p className="text-meta text-ink-2 [overflow-wrap:anywhere]">
              We read this from your old payment notes{source ? `: “${source}”` : "."} Check each way to pay, then save.
            </p>
            {canEdit ? (
              <Button variant="tonal" size="md" onClick={() => onChange({ ...p, source: "owner", confirmed: true })}>
                Yes, this is right
              </Button>
            ) : null}
          </div>
        ) : null}
        {p.methods.map((m) => {
          const err = METHOD_ERRORS[m].map((k) => errors[k]).find(Boolean);
          return (
            <OpenRow
              key={m}
              id={`pay-row-${m}`}
              title={labelOfMethod(m)}
              value={methodSummary(p, m) || undefined}
              error={err}
              disabled={!canEdit}
              onOpen={() => open(m)}
            />
          );
        })}
        {p.methods.length === 0 ? (
          <p className="px-4 py-3 text-meta text-ink-2">Add how customers pay, so your Business Assistant can tell callers the exact number.</p>
        ) : null}
        {canEdit && available.length ? <AddRow label="Add a way to pay" onOpen={() => open("pick")} /> : null}
      </SettingsGroup>

      <SettingsGroup title="When customers pay">
        <OpenRow
          id="pay-row-timing"
          title="When"
          value={timingSummary || "Not set"}
          error={timingError}
          disabled={!canEdit}
          onOpen={() => open("timing")}
        />
        <div className="px-4 py-3">
          <TextAreaField
            id="pay-note"
            label="Payment note (optional)"
            hint="Anything else callers should know about paying. For example: send the M-Pesa message on WhatsApp."
            maxLength={NOTE_MAX}
            rows={2}
            disabled={!canEdit}
            error={errors.note}
            value={p.note ?? ""}
            onChange={(e) => onChange({ ...p, note: e.target.value || null })}
          />
        </div>
      </SettingsGroup>

      <CallersHear text={paymentsSentence(p)} empty="Add a way to pay to hear what callers are told." />

      {/* Pick a method */}
      <Sheet open={sheet === "pick"} onOpenChange={(o) => !o && setSheet(null)} title="Add a way to pay" description="Pick one. You can add more after.">
        <ul className="-mx-1 divide-y divide-hairline">
          {available.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                onClick={() => {
                  if (NO_FIELDS.includes(o.id)) {
                    onChange({ ...withMethod(p, o.id), source: "owner", confirmed: true });
                    setSheet(null);
                  } else open(o.id);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">{o.label}</span>
                  {o.detail ? <span className="mt-0.5 block text-meta text-ink-2">{o.detail}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {/* One method's fields */}
      <Sheet
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setSheet(null)}
        title={editing ? labelOfMethod(editing) : ""}
        description={editing ? PAYMENT_METHODS.find((o) => o.id === editing)?.detail : undefined}
        footer={
          editing ? (
            <>
              {p.methods.includes(editing) ? (
                <Button variant="ghost" size="md" className="me-auto text-attention" onClick={() => remove(editing)}>
                  Remove
                </Button>
              ) : null}
              <Button variant="ghost" size="md" onClick={() => setSheet(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={() => commit(draft, METHOD_ERRORS[editing])}>
                Done
              </Button>
            </>
          ) : null
        }
      >
        {editing ? <MethodFields method={editing} draft={draft} setDraft={(next) => { setDraft(next); setDraftErrors({}); }} errors={draftErrors} /> : null}
        {editing ? (
          <div className="mt-4">
            <CallersHear text={paymentsSentence({ ...draft, timings: [], note: null, methods: [editing] })} />
          </div>
        ) : null}
      </Sheet>

      {/* When customers pay */}
      <Sheet
        open={sheet === "timing"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="When customers pay"
        description="Pick every one that applies."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setSheet(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={() => commit(draft, ["timings", "deposit_percent"])}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <CheckList<PaymentTiming>
            label="When"
            multiple
            options={PAYMENT_TIMING}
            value={draft.timings}
            onChange={(timings) => {
              setDraftErrors({});
              setDraft({ ...draft, timings, deposit_percent: timings.includes("deposit_then_balance") ? draft.deposit_percent ?? 50 : null });
            }}
          />
          {draft.timings.includes("deposit_then_balance") ? (
            <TextField
              id="pay-deposit"
              label="Deposit (%)"
              hint="The part paid first. The balance follows."
              inputMode="numeric"
              maxLength={2}
              className="max-w-40"
              error={draftErrors.deposit_percent}
              value={draft.deposit_percent == null ? "" : String(draft.deposit_percent)}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setDraftErrors({});
                setDraft({ ...draft, deposit_percent: v ? Number(v) : null });
              }}
            />
          ) : null}
          <CallersHear text={paymentsSentence({ ...draft, methods: [], note: null })} />
        </div>
      </Sheet>
    </div>
  );
}

function MethodFields({
  method,
  draft,
  setDraft,
  errors,
}: {
  method: PaymentMethod;
  draft: Payments;
  setDraft: (p: Payments) => void;
  errors: Record<string, string>;
}) {
  const digitsOnly = (v: string) => v.replace(/\D/g, "");
  switch (method) {
    case "mpesa_till":
      return (
        <TextField
          id="pay-till"
          label="Till number"
          hint="The Buy Goods number on your Lipa na M-Pesa sticker. 5 to 7 digits."
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          error={errors.mpesa_till}
          value={draft.mpesa_till ?? ""}
          onChange={(e) => setDraft({ ...draft, mpesa_till: digitsOnly(e.target.value) })}
          placeholder="e.g. 123456"
        />
      );
    case "mpesa_paybill": {
      const pb = draft.mpesa_paybill ?? { business_no: "", account_mode: "fixed" as PaybillAccountMode, account: null };
      return (
        <div className="space-y-4">
          <TextField
            id="pay-paybill"
            label="Business number"
            hint="Your Paybill number. 5 to 7 digits."
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            error={errors.paybill}
            value={pb.business_no}
            onChange={(e) => setDraft({ ...draft, mpesa_paybill: { ...pb, business_no: digitsOnly(e.target.value) } })}
            placeholder="e.g. 247247"
          />
          <CheckList<PaybillAccountMode>
            label="Account number customers type"
            options={PAYBILL_ACCOUNT_MODES}
            value={[pb.account_mode]}
            onChange={([account_mode]) => setDraft({ ...draft, mpesa_paybill: { ...pb, account_mode } })}
          />
          {pb.account_mode === "fixed" ? (
            <TextField
              id="pay-account"
              label="Account number"
              hint="For a bank paybill, this is your bank account number."
              autoComplete="off"
              maxLength={40}
              error={errors.paybill_account}
              value={pb.account ?? ""}
              onChange={(e) => setDraft({ ...draft, mpesa_paybill: { ...pb, account: e.target.value } })}
              placeholder="e.g. SHOP01"
            />
          ) : null}
        </div>
      );
    }
    case "pochi":
      return (
        <TextField
          id="pay-pochi"
          label="Pochi la Biashara number"
          hint="The Safaricom number you opted in with on *334#."
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={24}
          error={errors.pochi_phone}
          value={phoneValue(draft.pochi?.phone)}
          onChange={(e) => setDraft({ ...draft, pochi: { phone: e.target.value } })}
          placeholder="0712 345 678"
        />
      );
    case "mpesa_send":
      return (
        <div className="space-y-4">
          <TextField
            id="pay-send"
            label="M-Pesa number"
            hint="The number customers send money to."
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={24}
            error={errors.send_phone}
            value={phoneValue(draft.mpesa_send?.phone)}
            onChange={(e) => setDraft({ ...draft, mpesa_send: { phone: e.target.value, name: draft.mpesa_send?.name ?? null } })}
            placeholder="0712 345 678"
          />
          <TextField
            id="pay-send-name"
            label="Name on the line (optional)"
            hint="Customers see this name before they confirm."
            autoComplete="off"
            maxLength={60}
            value={draft.mpesa_send?.name ?? ""}
            onChange={(e) => setDraft({ ...draft, mpesa_send: { phone: draft.mpesa_send?.phone ?? "", name: e.target.value || null } })}
            placeholder="e.g. Jane Wanjiku"
          />
        </div>
      );
    case "airtel":
      return (
        <div className="space-y-4">
          <TextField
            id="pay-airtel-till"
            label="Airtel Money till (optional)"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            error={errors.airtel_till || errors.airtel}
            value={draft.airtel?.till ?? ""}
            onChange={(e) => setDraft({ ...draft, airtel: { till: digitsOnly(e.target.value) || null, phone: draft.airtel?.phone ?? null } })}
          />
          <TextField
            id="pay-airtel-phone"
            label="Airtel Money number (optional)"
            hint="Add a till, a number, or both."
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={24}
            error={errors.airtel_phone}
            value={phoneValue(draft.airtel?.phone)}
            onChange={(e) => setDraft({ ...draft, airtel: { till: draft.airtel?.till ?? null, phone: e.target.value || null } })}
            placeholder="0733 123 456"
          />
        </div>
      );
    case "bank": {
      const b = draft.bank ?? { bank_name: "", account_name: "", account_no: "" };
      return (
        <div className="space-y-4">
          <TextField
            id="pay-bank"
            label="Bank"
            list="pay-bank-list"
            autoComplete="off"
            maxLength={60}
            error={errors.bank_name}
            value={b.bank_name}
            onChange={(e) => setDraft({ ...draft, bank: { ...b, bank_name: e.target.value } })}
            placeholder="e.g. Equity Bank"
          />
          <datalist id="pay-bank-list">
            {KENYA_BANKS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <TextField
            id="pay-bank-name"
            label="Account name"
            autoComplete="off"
            maxLength={80}
            error={errors.bank_account_name}
            value={b.account_name}
            onChange={(e) => setDraft({ ...draft, bank: { ...b, account_name: e.target.value } })}
            placeholder="e.g. Aris Stationeries Ltd"
          />
          <TextField
            id="pay-bank-no"
            label="Account number"
            hint="Customers can also pay this from M-Pesa through your bank's paybill."
            inputMode="numeric"
            autoComplete="off"
            maxLength={24}
            error={errors.bank_account_no}
            value={b.account_no}
            onChange={(e) => setDraft({ ...draft, bank: { ...b, account_no: digitsOnly(e.target.value) } })}
          />
        </div>
      );
    }
    case "card":
      return (
        <CheckList<CardWhere>
          label="Where customers pay by card (optional)"
          multiple
          options={CARD_WHERE}
          value={draft.card?.where ?? []}
          onChange={(where) => setDraft({ ...draft, card: { where } })}
        />
      );
    default:
      return <p className="text-body text-ink-2">Nothing else to add.</p>;
  }
}
