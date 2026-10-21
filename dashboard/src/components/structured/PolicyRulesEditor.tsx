"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { SettingsGroup, SettingsSegmented } from "@/components/settingsUi";
import {
  CANCEL_FEES,
  DELIVERY_FEE_MODES,
  DELIVERY_MODES,
  DELIVERY_SPEEDS,
  NOTICE_HOURS,
  NO_SHOW_CHARGES,
  POLICY_TOPICS,
  RETURNS_CONDITIONS,
  RETURNS_MODES,
  RETURN_DAYS,
  RULE_NOTE_MAX,
  WAIT_MINUTES,
  WARRANTY_COVERS,
  WARRANTY_MONTHS,
  emptyRule,
  ruleSentence,
  topicsFor,
  validateRules,
  type BookingChangesRule,
  type CancellationRule,
  type DeliveryRule,
  type NoShowRule,
  type PolicyRules,
  type PolicyTopic,
  type ReturnsRule,
  type WarrantyRule,
} from "@/lib/policyRules";
import { cleanLegacyPolicyText, legacyRuleRowText } from "@/lib/ownerPolicyCopy";
import { usePointerKind } from "@/components/ui/usePointerKind";
import { AddRow, CallersHear, CheckList, OpenRow } from "./PickList";

const topicLabel = (t: PolicyTopic) => POLICY_TOPICS.find((o) => o.id === t)?.label || t;
const hoursLabel = (h: number) => (h === 0 ? "Any time" : h < 24 ? `${h} hours` : h === 24 ? "1 day" : `${h / 24} days`);
const ksh = (v: string) => {
  const n = Number(v.replace(/\D/g, ""));
  return v.replace(/\D/g, "") && Number.isFinite(n) ? n : null;
};

/** Old text key the call brain read for a topic before rules existed. */
const LEGACY_KEY: Record<PolicyTopic, "returns" | "delivery" | "cancellation" | "warranty" | null> = {
  returns: "returns",
  delivery: "delivery",
  cancellation: "cancellation",
  booking_changes: null,
  no_show: null,
  warranty: "warranty",
};

/**
 * Policy rules: one row per rule with what callers hear, each opening a bottom drawer of
 * short choices plus an optional note. Topics with only old free text show a tidy summary
 * and open pre-filled, so nothing the owner wrote is lost. Starter text and lines written
 * for the assistant are not shown here (the caller passes owner text only).
 */
export function PolicyRulesEditor({
  rules,
  legacy,
  vertical,
  onChange,
  errors = {},
  canEdit = true,
}: {
  rules: PolicyRules;
  legacy: Partial<Record<"returns" | "delivery" | "cancellation" | "warranty", string>>;
  vertical: string | null | undefined;
  onChange: (next: PolicyRules) => void;
  errors?: Record<string, string>;
  canEdit?: boolean;
}) {
  const [sheet, setSheet] = useState<null | "pick" | PolicyTopic>(null);
  const [draft, setDraft] = useState<PolicyRules>(rules);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const pointer = usePointerKind();
  const offered = topicsFor(vertical);
  const legacyText = (t: PolicyTopic) => (LEGACY_KEY[t] ? cleanLegacyPolicyText(legacy[LEGACY_KEY[t]!]) : null);
  const legacyOnly = (t: PolicyTopic) => !rules[t] && Boolean(legacyText(t));
  const shown = [...offered, ...POLICY_TOPICS.map((o) => o.id).filter((t) => !offered.includes(t))].filter((t) => rules[t] || legacyOnly(t));
  const addable = POLICY_TOPICS.filter((o) => !shown.includes(o.id)).sort((a, b) => {
    const ia = offered.indexOf(a.id);
    const ib = offered.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  function open(t: PolicyTopic | "pick") {
    if (t !== "pick" && !rules[t]) {
      const seed = emptyRule(t) as { note: string | null };
      const old = legacyText(t);
      setDraft({ ...rules, [t]: { ...seed, note: old ? old.slice(0, RULE_NOTE_MAX) : null } });
    } else setDraft(rules);
    setDraftErrors({});
    setSheet(t);
  }

  function done(t: PolicyTopic) {
    const all = validateRules(draft);
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(`${t}.`)));
    setDraftErrors(mine);
    if (Object.keys(mine).length) return;
    onChange({ ...rules, [t]: draft[t] });
    setSheet(null);
  }

  function remove(t: PolicyTopic) {
    const next = { ...rules };
    delete next[t];
    onChange(next);
    setSheet(null);
  }

  const editing = sheet && sheet !== "pick" ? sheet : null;
  const err = (k: string) => draftErrors[k];
  const set = <K extends PolicyTopic>(t: K, patch: Partial<NonNullable<PolicyRules[K]>>) => {
    setDraftErrors({});
    setDraft((d) => ({ ...d, [t]: { ...(d[t] as object), ...patch } }));
  };

  return (
    <>
      <SettingsGroup title="Rules">
        {shown.map((t) => {
          const rowError = Object.entries(errors).find(([k]) => k.startsWith(`rules.${t}.`))?.[1];
          return (
            <OpenRow
              key={t}
              id={`rule-row-${t}`}
              title={topicLabel(t)}
              value={rules[t] ? ruleSentence(t, rules) : legacyRuleRowText(legacy[LEGACY_KEY[t]!], pointer)}
              error={rowError}
              disabled={!canEdit}
              onOpen={() => open(t)}
            />
          );
        })}
        {shown.length === 0 ? (
          <p className="px-4 py-3 text-meta text-ink-2">
            No rules yet. Add the ones callers ask about, like {offered.slice(0, 2).map((t) => topicLabel(t).toLowerCase()).join(" or ")}.
          </p>
        ) : null}
        {canEdit && addable.length ? <AddRow label="Add a rule" onOpen={() => open("pick")} /> : null}
      </SettingsGroup>

      <Sheet open={sheet === "pick"} onOpenChange={(o) => !o && setSheet(null)} title="Add a rule" description="Pick a rule. You choose the details next.">
        <ul className="-mx-1 divide-y divide-hairline">
          {addable.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                onClick={() => open(o.id)}
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

      <Sheet
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setSheet(null)}
        title={editing ? topicLabel(editing) : ""}
        size="lg"
        footer={
          editing ? (
            <>
              {rules[editing] ? (
                <Button variant="ghost" size="md" className="me-auto text-attention" onClick={() => remove(editing)}>
                  Remove
                </Button>
              ) : null}
              <Button variant="ghost" size="md" onClick={() => setSheet(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={() => done(editing)}>
                Done
              </Button>
            </>
          ) : null
        }
      >
        {editing && draft[editing] ? (
          <div className="space-y-5">
            {editing === "returns" ? <ReturnsFields r={draft.returns!} set={(p) => set("returns", p)} err={err} /> : null}
            {editing === "delivery" ? <DeliveryFields d={draft.delivery!} set={(p) => set("delivery", p)} err={err} /> : null}
            {editing === "cancellation" ? <CancellationFields c={draft.cancellation!} set={(p) => set("cancellation", p)} err={err} /> : null}
            {editing === "booking_changes" ? <BookingChangesFields b={draft.booking_changes!} set={(p) => set("booking_changes", p)} /> : null}
            {editing === "no_show" ? <NoShowFields n={draft.no_show!} set={(p) => set("no_show", p)} err={err} /> : null}
            {editing === "warranty" ? <WarrantyFields w={draft.warranty!} set={(p) => set("warranty", p)} err={err} /> : null}
            <TextAreaField
              id={`rule-note-${editing}`}
              label="Note (optional)"
              hint="Anything the choices don't cover. Callers hear it as written."
              maxLength={RULE_NOTE_MAX}
              rows={2}
              value={(draft[editing] as { note: string | null }).note ?? ""}
              onChange={(e) => set(editing, { note: e.target.value || null } as never)}
            />
            <CallersHear text={ruleSentence(editing, draft)} />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

type Err = (k: string) => string | undefined;

function ReturnsFields({ r, set, err }: { r: ReturnsRule; set: (p: Partial<ReturnsRule>) => void; err: Err }) {
  return (
    <>
      <CheckList label="What customers can do" options={RETURNS_MODES} value={[r.mode]} onChange={([mode]) => set({ mode })} />
      {r.mode !== "none" ? (
        <>
          <div>
            <p className="mb-1.5 text-meta font-medium text-ink">Within</p>
            <SettingsSegmented label="Days to return" value={String(r.days ?? "")} options={RETURN_DAYS.map((d) => ({ id: String(d), label: d === 1 ? "1 day" : `${d} days` }))} onChange={(v) => set({ days: Number(v) })} />
            {err("returns.days") ? <p role="alert" className="mt-1.5 text-meta text-attention">{err("returns.days")}</p> : null}
          </div>
          <CheckList label="Conditions" multiple options={RETURNS_CONDITIONS} value={r.conditions} onChange={(conditions) => set({ conditions })} />
        </>
      ) : null}
    </>
  );
}

function DeliveryFields({ d, set, err }: { d: DeliveryRule; set: (p: Partial<DeliveryRule>) => void; err: Err }) {
  return (
    <>
      <CheckList label="Delivery" options={DELIVERY_MODES} value={[d.mode]} onChange={([mode]) => set({ mode })} />
      {d.mode === "deliver" ? (
        <>
          <TextField id="rule-delivery-areas" label="Where you deliver (optional)" maxLength={200} value={d.areas ?? ""} onChange={(e) => set({ areas: e.target.value || null })} placeholder="e.g. Nairobi CBD, Westlands and Kilimani" />
          <CheckList label="How fast" options={DELIVERY_SPEEDS} value={d.speed ? [d.speed] : []} onChange={([speed]) => set({ speed })} />
          {d.speed === "same_day" ? (
            <TextField id="rule-delivery-cutoff" label="Order before (optional)" type="time" className="max-w-48" value={d.cutoff ?? ""} onChange={(e) => set({ cutoff: e.target.value || null })} />
          ) : null}
          <CheckList label="Delivery fee" options={DELIVERY_FEE_MODES} value={d.fee_mode ? [d.fee_mode] : []} onChange={([fee_mode]) => set({ fee_mode })} />
          {d.fee_mode === "flat" ? (
            <TextField id="rule-delivery-fee" label="Fee (KSh)" inputMode="numeric" className="max-w-48" error={err("delivery.fee_ksh")} value={d.fee_ksh == null ? "" : String(d.fee_ksh)} onChange={(e) => set({ fee_ksh: ksh(e.target.value) })} placeholder="e.g. 200" />
          ) : null}
          {d.fee_mode && d.fee_mode !== "free" ? (
            <TextField id="rule-delivery-free-over" label="Free for orders over (KSh, optional)" inputMode="numeric" className="max-w-64" error={err("delivery.free_over_ksh")} value={d.free_over_ksh == null ? "" : String(d.free_over_ksh)} onChange={(e) => set({ free_over_ksh: ksh(e.target.value) })} placeholder="e.g. 5000" />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CancellationFields({ c, set, err }: { c: CancellationRule; set: (p: Partial<CancellationRule>) => void; err: Err }) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-meta font-medium text-ink">Free to cancel up to</p>
        <SettingsSegmented label="Notice needed" value={String(c.notice_hours ?? 0)} options={NOTICE_HOURS.map((h) => ({ id: String(h), label: hoursLabel(h) }))} onChange={(v) => set({ notice_hours: Number(v) })} />
      </div>
      <CheckList label="After that" options={CANCEL_FEES} value={[c.fee]} onChange={([fee]) => set({ fee })} />
      {c.fee === "flat" ? (
        <TextField id="rule-cancel-fee" label="Fee (KSh)" inputMode="numeric" className="max-w-48" error={err("cancellation.fee_ksh")} value={c.fee_ksh == null ? "" : String(c.fee_ksh)} onChange={(e) => set({ fee_ksh: ksh(e.target.value) })} />
      ) : null}
    </>
  );
}

function BookingChangesFields({ b, set }: { b: BookingChangesRule; set: (p: Partial<BookingChangesRule>) => void }) {
  return (
    <>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-body text-ink">Customers can move a booking</span>
        <Switch label="Customers can move a booking" checked={b.allowed} onCheckedChange={(allowed) => set({ allowed })} />
      </div>
      {b.allowed ? (
        <div>
          <p className="mb-1.5 text-meta font-medium text-ink">Up to</p>
          <SettingsSegmented label="Notice to move a booking" value={String(b.notice_hours ?? 0)} options={NOTICE_HOURS.map((h) => ({ id: String(h), label: hoursLabel(h) }))} onChange={(v) => set({ notice_hours: Number(v) })} />
        </div>
      ) : null}
    </>
  );
}

function NoShowFields({ n, set, err }: { n: NoShowRule; set: (p: Partial<NoShowRule>) => void; err: Err }) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-meta font-medium text-ink">We wait</p>
        <SettingsSegmented label="Minutes we wait" value={String(n.wait_minutes ?? "")} options={WAIT_MINUTES.map((m) => ({ id: String(m), label: m === 60 ? "1 hour" : `${m} min` }))} onChange={(v) => set({ wait_minutes: Number(v) })} />
      </div>
      <CheckList label="After that" options={NO_SHOW_CHARGES} value={[n.charge]} onChange={([charge]) => set({ charge })} />
      {n.charge === "callout" ? (
        <TextField id="rule-noshow-fee" label="Call-out fee (KSh)" inputMode="numeric" className="max-w-48" error={err("no_show.fee_ksh")} value={n.fee_ksh == null ? "" : String(n.fee_ksh)} onChange={(e) => set({ fee_ksh: ksh(e.target.value) })} />
      ) : null}
    </>
  );
}

function WarrantyFields({ w, set, err }: { w: WarrantyRule; set: (p: Partial<WarrantyRule>) => void; err: Err }) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-meta font-medium text-ink">How long</p>
        <SettingsSegmented label="Warranty length" value={String(w.months ?? "")} options={WARRANTY_MONTHS.map((m) => ({ id: String(m), label: m === 12 ? "1 year" : m === 24 ? "2 years" : `${m} month${m === 1 ? "" : "s"}` }))} onChange={(v) => set({ months: Number(v) })} />
        {err("warranty.months") ? <p role="alert" className="mt-1.5 text-meta text-attention">{err("warranty.months")}</p> : null}
      </div>
      <CheckList label="Covers" multiple options={WARRANTY_COVERS} value={w.covers} onChange={(covers) => set({ covers })} />
    </>
  );
}
