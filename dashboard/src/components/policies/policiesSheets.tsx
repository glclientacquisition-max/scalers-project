"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { UnknownAnswerField } from "@/components/UnknownAnswerField";
import {
  CARD_WHERE,
  KENYA_BANKS,
  NOTE_MAX,
  PAYBILL_ACCOUNT_MODES,
  PAYMENT_METHODS,
  emptyPayments,
  kenyanMobileDisplay,
  kenyanMobileE164,
  labelOfMethod,
  paymentsSentence,
  validatePayments,
  type CardWhere,
  type PaybillAccountMode,
  type PaymentMethod,
  type PaymentTiming,
  type Payments,
} from "@/lib/payments";
import { CANCEL_FEES, normalizeRules, validateRules, type PolicyRules, type PolicyTopic } from "@/lib/policyRules";
import {
  CUSTOM,
  OWN_WORDS_MAX,
  TOPICS,
  draftErrors,
  draftFrom,
  ruleFromDraft,
  spokenLine,
  type Draft,
  type NicheDef,
  type Rule,
  type Scalar,
} from "@/lib/policyRegistry";
import { HOLD_HOURS_OPTIONS, readHoldRules, holdRulesValue } from "@/lib/businessPolicies";
import {
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_PAYBILL_ACCOUNT,
  SERVICE_PAY_ANSWERS,
  SUGGESTED_RETAIL_TIMINGS,
  SUGGESTED_SERVICE_PAY,
  defaultRule,
  legacyTopicText,
  paybillAccountSentence,
  retailTimingOptions,
  ruleLabel,
  servicePayAnswer,
  storedRules,
  timingsForServiceAnswer,
  withFeeAmount,
  type PoliciesKind,
  type PoliciesPatch,
  type ServicePayAnswer,
  type StoredPolicies,
} from "@/lib/policiesRemake";
import { CheckFieldset, ChipFieldset, RadioFieldset, SheetHear } from "./policiesKit";

const digitsOnly = (v: string) => v.replace(/\D/g, "");
const ksh = (v: string): number | null => {
  const d = digitsOnly(v);
  const n = Number(d);
  return d && Number.isFinite(n) ? n : null;
};

function SheetFooter({
  onCancel,
  onSave,
  onRemove,
  removeLabel = "Remove",
  saveLabel = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  saveLabel?: string;
}) {
  return (
    <>
      {onRemove ? (
        <Button variant="ghost" size="md" className="me-auto text-attention" onClick={onRemove}>
          {removeLabel}
        </Button>
      ) : null}
      <Button variant="ghost" size="md" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="primary" size="md" onClick={onSave}>
        {saveLabel}
      </Button>
    </>
  );
}

/** Small "Add a note" disclosure, so an optional field costs one tap, not a box on every sheet. */
function OptionalNote({
  id,
  label,
  value,
  onChange,
  max,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  hint?: string;
  error?: string;
}) {
  const [open, setOpen] = useState(Boolean(value));
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls={id}
        className="inline-flex min-h-11 items-center rounded-lg px-1 text-body font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Add a note
      </button>
    );
  }
  return <TextAreaField id={id} label={label} hint={hint} maxLength={max} rows={2} error={error} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/* ---------------- Rules ---------------- */

/** Plain answer labels per topic: what the owner means, not a one-word chip. */
function answerLabel(topic: PolicyTopic, answerId: string, kind: PoliciesKind): string {
  const map: Record<string, string> = {
    "cancellation.yes": "Customers can cancel",
    "cancellation.no": "No cancellations",
    "booking_changes.yes": "Customers can move a booking",
    "booking_changes.no": "Bookings can't be moved",
    "no_show.wait": "We wait, then call",
    "no_show.callout": "We wait, then charge a call-out fee",
    "no_show.no": "We don't wait",
    "warranty.yes": kind === "services" ? "We guarantee our work" : "We give a warranty",
    "warranty.no": kind === "services" ? "No guarantee" : "No warranty",
    "returns.refund": "Refund or exchange",
    "returns.exchange": "Exchange only",
    "returns.no": "No returns",
    "delivery.yes": "We deliver",
    "delivery.no": "Pickup only",
  };
  return map[`${topic}.${answerId}`] || TOPICS[topic].answers.find((a) => a.id === answerId)?.label || answerId;
}

function questionOf(topic: PolicyTopic, kind: PoliciesKind): string {
  const map: Record<PolicyTopic, string> = {
    cancellation: "Can customers cancel?",
    booking_changes: "Can customers move a booking?",
    no_show: "If the customer is late or not there",
    warranty: kind === "services" ? "Do you guarantee your work?" : "Do you give a warranty?",
    returns: "Do you take returns?",
    delivery: "Do you deliver?",
  };
  return map[topic];
}

function followLabel(topic: PolicyTopic, field: string): string {
  if (field === "notice_hours") return topic === "booking_changes" ? "Can move up to" : "Free to cancel up to";
  if (field === "fee") return "If they cancel later";
  if (field === "wait_minutes") return "We wait";
  if (field === "months") return "How long";
  if (field === "days") return "Within (days)";
  if (field === "conditions") return "If the item is";
  if (field === "speed") return "How fast";
  return field;
}

type RuleDraft = Draft & { fee_ksh: number | null };

function seedRuleDraft(raw: StoredPolicies, topic: PolicyTopic): { draft: RuleDraft; oldNote: string | null } {
  const def = TOPICS[topic];
  const stored = storedRules(raw)[topic] ?? null;
  if (stored) {
    const d = draftFrom(def, stored);
    const oldNote = d.answer !== CUSTOM && typeof stored.note === "string" && stored.note.trim() ? stored.note.trim() : null;
    return { draft: { ...d, fee_ksh: typeof stored.fee_ksh === "number" ? stored.fee_ksh : null }, oldNote };
  }
  const legacy = legacyTopicText(raw, topic);
  if (legacy) {
    // Old typed text opens as the owner's own words, word for word.
    return { draft: { ...draftFrom(def, null), answer: CUSTOM, note: legacy, note_sw: "", checked: false, fee_ksh: null }, oldNote: null };
  }
  return { draft: { ...draftFrom(def, defaultRule(topic)), fee_ksh: null }, oldNote: null };
}

function ruleOf(topic: PolicyTopic, d: RuleDraft): Rule | null {
  const rule = ruleFromDraft(TOPICS[topic], d);
  if (!rule) return null;
  const needsFee = (topic === "cancellation" && rule.fee === "flat") || (topic === "no_show" && rule.charge === "callout");
  if (needsFee) rule.fee_ksh = d.fee_ksh;
  return rule;
}

export function RuleSheet({
  open,
  topic,
  kind,
  niche,
  raw,
  onClose,
  onSave,
}: {
  open: boolean;
  topic: PolicyTopic;
  kind: PoliciesKind;
  niche: NicheDef;
  raw: StoredPolicies;
  onClose: () => void;
  onSave: (patch: PoliciesPatch) => void;
}) {
  const def = TOPICS[topic];
  const [{ draft: initialDraft, oldNote }] = useState(() => seedRuleDraft(raw, topic));
  const [draft, setDraft] = useState<RuleDraft>(initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [swOpen, setSwOpen] = useState(Boolean(initialDraft.note_sw));
  const hasSomething = Boolean(storedRules(raw)[topic] || legacyTopicText(raw, topic));
  const answer = def.answers.find((a) => a.id === draft.answer) ?? null;
  const rule = ruleOf(topic, draft);
  const preview = rule ? withFeeAmount(spokenLine(def, rule, niche), rule).en : "";
  const label = ruleLabel(topic, kind);
  const set = (patch: Partial<RuleDraft>) => {
    setErrors({});
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setValue = (field: string, v: Scalar | Scalar[]) => set({ values: { ...draft.values, [field]: v } });

  function save() {
    const errs: Record<string, string> = {};
    for (const e of draftErrors(draft)) if (!errs[e.field]) errs[e.field] = e.inline;
    if (rule && draft.answer !== CUSTOM) {
      for (const [k, v] of Object.entries(validateRules(normalizeRules({ [topic]: rule }) as PolicyRules))) {
        if (k.endsWith("fee_ksh")) errs.fee_ksh = v;
        else errs[k] = v;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length || !rule) return;
    const patch: PoliciesPatch = { rules: { [topic]: rule } };
    // A note from the older editor is never dropped: it moves to Anything else.
    const other = String((raw as { other?: unknown }).other ?? "").trim();
    if (oldNote && draft.answer !== CUSTOM && !other.includes(oldNote)) patch.other = `${other} ${oldNote}`.trim();
    onSave(patch);
  }

  const answers = [
    ...def.answers.map((a) => ({ id: a.id, label: answerLabel(topic, a.id, kind) })),
    { id: CUSTOM, label: "In my own words" },
  ];

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={label}
      size="lg"
      footer={<SheetFooter onCancel={onClose} onSave={save} onRemove={hasSomething ? () => onSave({ rules: { [topic]: null } }) : undefined} />}
    >
      <div className="space-y-5" data-rule-sheet={topic}>
        <RadioFieldset legend={questionOf(topic, kind)} name={`rule-${topic}-answer`} options={answers} value={draft.answer} onChange={(id) => set({ answer: id })} />
        {answer?.follow?.map((f) =>
          f.multi ? (
            <CheckFieldset
              key={f.field}
              legend={followLabel(topic, f.field)}
              hint="Pick any"
              name={`rule-${topic}-${f.field}`}
              options={f.options.map((o) => ({ id: String(o.value), label: o.label }))}
              value={(Array.isArray(draft.values[f.field]) ? (draft.values[f.field] as Scalar[]) : []).map(String)}
              onChange={(next) => setValue(f.field, next)}
            />
          ) : f.field === "fee" ? (
            <RadioFieldset
              key={f.field}
              legend={followLabel(topic, f.field)}
              name={`rule-${topic}-${f.field}`}
              options={CANCEL_FEES.map((o) => ({ id: o.id, label: o.id === "deposit_kept" ? "We keep the deposit" : o.label }))}
              value={String(draft.values[f.field] ?? f.initial)}
              onChange={(id) => setValue(f.field, id)}
            />
          ) : (
            <ChipFieldset
              key={f.field}
              legend={followLabel(topic, f.field)}
              name={`rule-${topic}-${f.field}`}
              options={f.options.map((o) => ({ value: String(o.value), label: o.label }))}
              value={String(draft.values[f.field] ?? f.initial)}
              onChange={(v) => setValue(f.field, typeof f.initial === "number" ? Number(v) : v)}
            />
          ),
        )}
        {rule && ((topic === "cancellation" && rule.fee === "flat") || (topic === "no_show" && rule.charge === "callout")) ? (
          <TextField
            id={`rule-${topic}-fee`}
            label={topic === "no_show" ? "Call-out fee (KSh)" : "Cancellation fee (KSh)"}
            inputMode="numeric"
            autoComplete="off"
            className="max-w-48"
            error={errors.fee_ksh}
            value={draft.fee_ksh == null ? "" : String(draft.fee_ksh)}
            onChange={(e) => set({ fee_ksh: ksh(e.target.value) })}
          />
        ) : null}
        {topic === "delivery" && draft.answer === "yes" ? (
          <p className="text-meta text-ink-2">
            Delivery fees are set per area in{" "}
            <Link href="/settings/areas" className="font-semibold text-accent underline">
              Service areas
            </Link>
            .
          </p>
        ) : null}
        {draft.answer === CUSTOM ? (
          <div className="space-y-3">
            <TextAreaField
              id={`rule-${topic}-note`}
              label="What callers hear"
              hint={`Up to ${OWN_WORDS_MAX} letters. No phone numbers or links.`}
              maxLength={OWN_WORDS_MAX + 40}
              rows={2}
              error={errors.note}
              value={draft.note}
              onChange={(e) => set({ note: e.target.value, checked: false })}
            />
            {swOpen ? (
              <TextAreaField
                id={`rule-${topic}-note-sw`}
                label="In Kiswahili (optional)"
                hint="Left empty, callers who speak Kiswahili hear that the team will confirm."
                maxLength={OWN_WORDS_MAX + 40}
                rows={2}
                lang="sw"
                error={errors.note_sw}
                value={draft.note_sw}
                onChange={(e) => set({ note_sw: e.target.value, checked: false })}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSwOpen(true)}
                className="inline-flex min-h-11 items-center rounded-lg px-1 text-body font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Add Kiswahili
              </button>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 has-[:focus-visible]:rounded-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
              <input
                type="checkbox"
                checked={draft.checked}
                onChange={(e) => set({ checked: e.target.checked })}
                className="size-5 shrink-0 accent-[var(--color-accent,currentColor)]"
                aria-describedby={errors.checked ? `rule-${topic}-checked-error` : undefined}
              />
              <span className="text-body text-ink">Checked. OK for callers to hear.</span>
            </label>
            {errors.checked ? (
              <p id={`rule-${topic}-checked-error`} role="alert" className="text-meta text-attention">
                Tick this to save.
              </p>
            ) : null}
          </div>
        ) : null}
        {oldNote && draft.answer !== CUSTOM ? (
          <div className="rounded-2xl border border-hairline px-4 py-3" data-old-note="">
            <p className="text-meta font-medium text-ink">Your earlier note</p>
            <p className="mt-0.5 text-body text-ink-2 [overflow-wrap:anywhere]">{oldNote}</p>
            <p className="mt-1 text-meta text-ink-2">Saved to Anything else, so callers still hear it.</p>
          </div>
        ) : null}
        <SheetHear text={preview} empty="Write what callers hear." />
      </div>
    </Sheet>
  );
}

/* ---------------- When customers pay ---------------- */

export function PayTimingSheet({
  open,
  kind,
  payments,
  onClose,
  onSave,
}: {
  open: boolean;
  kind: PoliciesKind;
  payments: Payments | null;
  onClose: () => void;
  onSave: (patch: PoliciesPatch) => void;
}) {
  const base = payments ?? emptyPayments();
  const [answer, setAnswer] = useState<ServicePayAnswer>(() => servicePayAnswer(base) ?? SUGGESTED_SERVICE_PAY);
  const [timings, setTimings] = useState<PaymentTiming[]>(() => {
    const kept = base.timings.filter((t) => retailTimingOptions().some((o) => o.id === t));
    return kept.length ? kept : [...SUGGESTED_RETAIL_TIMINGS];
  });
  const [deposit, setDeposit] = useState<string>(base.deposit_percent == null ? String(DEFAULT_DEPOSIT_PERCENT) : String(base.deposit_percent));
  const [note, setNote] = useState(base.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const showDeposit = kind === "services" ? answer === "deposit" : timings.includes("deposit_then_balance");
  const next: Payments = (() => {
    const pct = deposit ? Number(deposit) : null;
    const when = kind === "services" ? timingsForServiceAnswer(answer, pct) : { timings, deposit_percent: timings.includes("deposit_then_balance") ? pct : null };
    if (kind === "services" && answer === "deposit") when.deposit_percent = pct;
    // Imported ways to pay stay "to check" until the owner confirms them on the card.
    const unchecked = base.methods.length > 0 && !base.confirmed;
    return { ...base, ...when, note: note.trim() || null, source: unchecked ? base.source : "owner", confirmed: unchecked ? base.confirmed : true };
  })();

  function save() {
    const errs = validatePayments(next);
    if (errs.deposit_percent) return setError(errs.deposit_percent);
    if (errs.note) return setError(errs.note);
    onSave({ payments: next });
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="When customers pay" footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-5" data-pay-timing-sheet={kind}>
        {kind === "services" ? (
          <RadioFieldset
            legend="Customers pay"
            name="pay-when"
            options={SERVICE_PAY_ANSWERS}
            value={answer}
            onChange={(id) => {
              setError(null);
              setAnswer(id);
            }}
          />
        ) : (
          <CheckFieldset
            legend="Customers pay"
            hint="Pick any"
            name="pay-when"
            options={retailTimingOptions()}
            value={timings}
            onChange={(t) => {
              setError(null);
              setTimings(t);
            }}
          />
        )}
        {showDeposit ? (
          <TextField
            id="pay-deposit"
            label="Deposit (%)"
            hint="The part paid first. The balance follows."
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            className="max-w-40"
            error={error}
            value={deposit}
            onChange={(e) => {
              setError(null);
              setDeposit(digitsOnly(e.target.value));
            }}
          />
        ) : error ? (
          <p role="alert" className="text-meta text-attention">
            {error}
          </p>
        ) : null}
        <OptionalNote
          id="pay-note"
          label="Anything else about paying (optional)"
          hint="For example: send the M-Pesa message on WhatsApp."
          max={NOTE_MAX}
          value={note}
          onChange={setNote}
        />
        <SheetHear text={paymentsSentence({ ...next, methods: [] })} />
      </div>
    </Sheet>
  );
}

/* ---------------- How customers pay ---------------- */

const NO_FIELDS: PaymentMethod[] = ["cash", "cheque"];
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

export function withMethod(p: Payments, m: PaymentMethod): Payments {
  const next = { ...p, methods: p.methods.includes(m) ? p.methods : [...p.methods, m] };
  if (m === "mpesa_paybill" && !next.mpesa_paybill) next.mpesa_paybill = { business_no: "", account_mode: DEFAULT_PAYBILL_ACCOUNT, account: null };
  if (m === "pochi" && !next.pochi) next.pochi = { phone: "" };
  if (m === "mpesa_send" && !next.mpesa_send) next.mpesa_send = { phone: "", name: null };
  if (m === "airtel" && !next.airtel) next.airtel = { till: null, phone: null };
  if (m === "bank" && !next.bank) next.bank = { bank_name: "", account_name: "", account_no: "" };
  if (m === "card" && !next.card) next.card = { where: [] };
  return next;
}

export function AddMethodSheet({
  open,
  payments,
  onClose,
  onPick,
}: {
  open: boolean;
  payments: Payments | null;
  onClose: () => void;
  onPick: (m: PaymentMethod) => void;
}) {
  const have = payments?.methods ?? [];
  const available = PAYMENT_METHODS.filter((o) => !have.includes(o.id));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Add a way to pay" description="Pick one. You can add more after.">
      <ul className="-mx-1 divide-y divide-hairline" data-add-method="">
        {available.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              onClick={() => onPick(o.id)}
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
  );
}

export const methodNeedsFields = (m: PaymentMethod) => !NO_FIELDS.includes(m);

function phoneValue(v: string | null | undefined): string {
  const e = kenyanMobileE164(v);
  return e && String(v).startsWith("+") ? kenyanMobileDisplay(e) : String(v ?? "");
}

export function MethodSheet({
  open,
  method,
  payments,
  isNew,
  onClose,
  onSave,
}: {
  open: boolean;
  method: PaymentMethod;
  payments: Payments | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (patch: PoliciesPatch) => void;
}) {
  const [draft, setDraft] = useState<Payments>(() => withMethod(payments ?? emptyPayments(), method));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [accountOpen, setAccountOpen] = useState(false);
  const update = (next: Payments) => {
    setErrors({});
    setDraft(next);
  };

  function save() {
    const all = validatePayments(draft);
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => METHOD_ERRORS[method].includes(k)));
    setErrors(mine);
    if (Object.keys(mine).length) {
      if (mine.paybill_account) setAccountOpen(true);
      return;
    }
    onSave({ payments: { ...draft, source: "owner", confirmed: true } });
  }

  const remove = isNew
    ? undefined
    : () => onSave({ payments: { ...(payments ?? emptyPayments()), methods: (payments?.methods ?? []).filter((x) => x !== method), source: "owner", confirmed: true } });
  const pb = draft.mpesa_paybill ?? { business_no: "", account_mode: DEFAULT_PAYBILL_ACCOUNT as PaybillAccountMode, account: null };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={labelOfMethod(method)}
      description={PAYMENT_METHODS.find((o) => o.id === method)?.detail}
      footer={<SheetFooter onCancel={onClose} onSave={save} onRemove={remove} />}
    >
      <div className="space-y-4" data-method-sheet={method}>
        {method === "mpesa_till" ? (
          <TextField
            id="pay-till"
            label="Till number"
            hint="The Buy Goods number on your Lipa na M-Pesa sticker. 5 to 7 digits."
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            error={errors.mpesa_till}
            value={draft.mpesa_till ?? ""}
            onChange={(e) => update({ ...draft, mpesa_till: digitsOnly(e.target.value) })}
            placeholder="123456"
          />
        ) : null}
        {method === "mpesa_paybill" ? (
          <>
            <TextField
              id="pay-paybill"
              label="Business number"
              hint="Your Paybill number. 5 to 7 digits."
              inputMode="numeric"
              autoComplete="off"
              maxLength={7}
              error={errors.paybill}
              value={pb.business_no}
              onChange={(e) => update({ ...draft, mpesa_paybill: { ...pb, business_no: digitsOnly(e.target.value) } })}
              placeholder="247247"
            />
            {accountOpen ? (
              <>
                <RadioFieldset
                  legend="Account number customers type"
                  name="pay-paybill-account"
                  options={PAYBILL_ACCOUNT_MODES}
                  value={pb.account_mode}
                  onChange={(account_mode) => update({ ...draft, mpesa_paybill: { ...pb, account_mode } })}
                />
                {pb.account_mode === "fixed" ? (
                  <TextField
                    id="pay-account"
                    label="Account number"
                    hint="For a bank paybill, this is your bank account number."
                    autoComplete="off"
                    maxLength={40}
                    showCount={false}
                    error={errors.paybill_account}
                    value={pb.account ?? ""}
                    onChange={(e) => update({ ...draft, mpesa_paybill: { ...pb, account: e.target.value } })}
                  />
                ) : null}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-hairline px-4 py-2" data-paybill-account="">
                <p className="min-w-0 text-body text-ink">{paybillAccountSentence(pb)}</p>
                <button
                  type="button"
                  onClick={() => setAccountOpen(true)}
                  aria-label="Change the account customers type"
                  className="-me-2 inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-body font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Change
                </button>
              </div>
            )}
          </>
        ) : null}
        {method === "pochi" ? (
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
            onChange={(e) => update({ ...draft, pochi: { phone: e.target.value } })}
            placeholder="0712 345 678"
          />
        ) : null}
        {method === "mpesa_send" ? (
          <>
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
              onChange={(e) => update({ ...draft, mpesa_send: { phone: e.target.value, name: draft.mpesa_send?.name ?? null } })}
              placeholder="0712 345 678"
            />
            <TextField
              id="pay-send-name"
              label="Name on the line (optional)"
              hint="Customers see this name before they confirm."
              autoComplete="off"
              maxLength={60}
              showCount={false}
              value={draft.mpesa_send?.name ?? ""}
              onChange={(e) => update({ ...draft, mpesa_send: { phone: draft.mpesa_send?.phone ?? "", name: e.target.value || null } })}
            />
          </>
        ) : null}
        {method === "airtel" ? (
          <>
            <TextField
              id="pay-airtel-till"
              label="Airtel Money till (optional)"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              error={errors.airtel_till || errors.airtel}
              value={draft.airtel?.till ?? ""}
              onChange={(e) => update({ ...draft, airtel: { till: digitsOnly(e.target.value) || null, phone: draft.airtel?.phone ?? null } })}
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
              onChange={(e) => update({ ...draft, airtel: { till: draft.airtel?.till ?? null, phone: e.target.value || null } })}
              placeholder="0733 123 456"
            />
          </>
        ) : null}
        {method === "bank" ? (
          <>
            <TextField
              id="pay-bank"
              label="Bank"
              list="pay-bank-list"
              autoComplete="off"
              maxLength={60}
              showCount={false}
              error={errors.bank_name}
              value={draft.bank?.bank_name ?? ""}
              onChange={(e) => update({ ...draft, bank: { ...(draft.bank ?? { bank_name: "", account_name: "", account_no: "" }), bank_name: e.target.value } })}
              placeholder="Equity Bank"
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
              showCount={false}
              error={errors.bank_account_name}
              value={draft.bank?.account_name ?? ""}
              onChange={(e) => update({ ...draft, bank: { ...(draft.bank ?? { bank_name: "", account_name: "", account_no: "" }), account_name: e.target.value } })}
            />
            <TextField
              id="pay-bank-no"
              label="Account number"
              inputMode="numeric"
              autoComplete="off"
              maxLength={24}
              error={errors.bank_account_no}
              value={draft.bank?.account_no ?? ""}
              onChange={(e) => update({ ...draft, bank: { ...(draft.bank ?? { bank_name: "", account_name: "", account_no: "" }), account_no: digitsOnly(e.target.value) } })}
            />
          </>
        ) : null}
        {method === "card" ? (
          <CheckFieldset<CardWhere>
            legend="Where customers pay by card (optional)"
            name="pay-card-where"
            options={CARD_WHERE}
            value={draft.card?.where ?? []}
            onChange={(where) => update({ ...draft, card: { where } })}
          />
        ) : null}
        {NO_FIELDS.includes(method) ? <p className="text-body text-ink-2">Nothing else to add.</p> : null}
        <SheetHear text={paymentsSentence({ ...draft, timings: [], note: null, methods: [method] })} />
      </div>
    </Sheet>
  );
}

/* ---------------- Holds (retail) ---------------- */

export function HoldsSheet({
  open,
  holds,
  holdNote,
  onClose,
  onSave,
}: {
  open: boolean;
  holds: unknown;
  holdNote: string;
  onClose: () => void;
  onSave: (patch: PoliciesPatch) => void;
}) {
  const start = readHoldRules(holds);
  const [hours, setHours] = useState<number>(start.max_hours ?? 24);
  const [deposit, setDeposit] = useState(start.deposit_required === "yes");
  const [note, setNote] = useState(holdNote);
  const hoursLabel = (h: number) => (h < 24 ? `${h} hours` : h === 24 ? "1 day" : `${h / 24} days`);
  function save() {
    const patch: PoliciesPatch = { holds: holdRulesValue({ allowed: "yes", max_hours: hours, deposit_required: deposit ? "yes" : "no" }) };
    if (note.trim() !== holdNote.trim()) patch.deposit = note;
    onSave(patch);
  }
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Holds" footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-5">
        <ChipFieldset legend="Longest hold" name="hold-hours" options={HOLD_HOURS_OPTIONS.map((h) => ({ value: h, label: hoursLabel(h) }))} value={hours} onChange={setHours} />
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-body text-ink" id="hold-deposit-label">
            Deposit needed to hold
          </span>
          <Switch label="Deposit needed to hold" checked={deposit} onCheckedChange={setDeposit} />
        </div>
        <OptionalNote id="hold-note" label="Anything else about holds (optional)" max={400} value={note} onChange={setNote} />
      </div>
    </Sheet>
  );
}

/* ---------------- When unsure ---------------- */

export function UnknownSheet({
  open,
  text,
  english,
  swahili,
  onClose,
  onSave,
  onReset,
}: {
  open: boolean;
  text: string;
  english: string;
  swahili: string;
  onClose: () => void;
  onSave: (v: { text: string; english: string; swahili: string; touched: boolean }) => void;
  onReset: () => void;
}) {
  const [t, setT] = useState(text);
  const [en, setEn] = useState(english);
  const [sw, setSw] = useState(swahili);
  const [touched, setTouched] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="When unsure" description="What your Business Assistant says when it doesn't know the answer." footer={<SheetFooter onCancel={onClose} onSave={() => onSave({ text: t, english: en, swahili: sw, touched })} />}>
      <div className="-mx-4" data-unknown-sheet="">
        <UnknownAnswerField
          text={t}
          onText={setT}
          onReset={() => {
            onReset();
          }}
          english={en}
          swahili={sw}
          updating={false}
          onEnglish={(v) => {
            setEn(v);
            setTouched(true);
          }}
          onSwahili={(v) => {
            setSw(v);
            setTouched(true);
          }}
        />
      </div>
    </Sheet>
  );
}
