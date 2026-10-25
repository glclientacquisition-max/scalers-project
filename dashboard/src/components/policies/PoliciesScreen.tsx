"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { buttonClass } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import {
  CUSTOM,
  NOT_SET,
  OWN_WORDS_MAX,
  PAYMENT_TOPIC,
  TOPICS,
  answersFor,
  checkOwnWords,
  draftErrors,
  draftFrom,
  nicheById,
  ruleFromDraft,
  spokenLine,
  topicStatus,
  type Draft,
  type Rule,
  type Spoken,
  type Status,
  type TopicDef,
} from "@/lib/policyRegistry";
import { savePolicyTopicAction, type PolicySaveResult } from "@/app/(desk)/settings/policies/actions";

type SaveFn = (topic: string, draft: Draft) => Promise<PolicySaveResult>;

export type PoliciesScreenProps = {
  nicheId: string;
  rules: Record<string, Rule>;
  /** Payment row: its line comes from lib/payments; its editor stays in Settings. */
  payment: { line: string | null; href: string };
  initialTopic?: string | null;
  /** Dev harness: show the example-data strip and preset a draft. */
  example?: string;
  initialDraft?: Partial<Draft> | null;
  initialSaved?: boolean;
  showErrors?: boolean;
  saveAction?: SaveFn;
};

const STATUS: Record<Status, { label: string; icon: string; cls: string }> = {
  set: { label: "Set", icon: "✓", cls: "bg-ok-tonal text-ok" },
  no: { label: "No", icon: "✕", cls: "bg-surface-2 text-ink" },
  custom: { label: "Own words", icon: "✎", cls: "bg-accent-tonal text-accent" },
  not_set: { label: "Not set", icon: "!", cls: "bg-attention-tonal text-attention" },
};

function Badge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-meta font-semibold", s.cls)}>
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}

function Example({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-4 mt-4 rounded-xl bg-surface-2 px-3 py-2 text-meta text-ink-2">
      <strong className="font-semibold text-ink">EXAMPLE DATA</strong> · {children}
    </p>
  );
}

function TopBar({ title, onBack, backHref }: { title: string; onBack?: () => void; backHref?: string }) {
  const cls = "grid h-11 w-11 place-items-center rounded-full text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div className="flex items-center gap-1 border-b border-hairline bg-surface px-2 py-1.5">
      {onBack ? (
        <button type="button" className={cls} onClick={onBack} aria-label="Back to Policies">
          <ChevronLeftIcon className="h-5 w-5" strokeWidth={2.2} />
        </button>
      ) : (
        <Link href={backHref ?? "/settings"} className={cls} aria-label="Back to Settings">
          <ChevronLeftIcon className="h-5 w-5" strokeWidth={2.2} />
        </Link>
      )}
      <h1 className="text-title font-semibold text-ink">{title}</h1>
    </div>
  );
}

export function PoliciesScreen(props: PoliciesScreenProps) {
  const niche = nicheById(props.nicheId);
  const [rules, setRules] = useState(props.rules);
  const [open, setOpen] = useState<string | null>(props.initialTopic && TOPICS[props.initialTopic] ? props.initialTopic : null);
  if (open) {
    return (
      <TopicEditor
        key={open}
        topic={TOPICS[open]}
        rule={rules[open] ?? null}
        niche={niche.id}
        example={props.example}
        initialDraft={props.initialDraft}
        initialSaved={props.initialSaved}
        showErrors={props.showErrors}
        saveAction={props.saveAction ?? savePolicyTopicAction}
        onBack={() => setOpen(null)}
        onSaved={(rule) => setRules((r) => { const n = { ...r }; if (rule) n[open] = rule; else delete n[open]; return n; })}
      />
    );
  }
  return (
    <div className="min-h-dvh bg-canvas pb-10 text-ink">
      <TopBar title="Policies" />
      {props.example ? <Example>{props.example}</Example> : null}
      <p className="px-4 pt-3 text-body text-ink-2">Each topic saves on its own.{niche.intro ? ` ${niche.intro}` : ""}</p>
      {niche.sections.map((section) => (
        <section key={section.id} aria-labelledby={`sec-${section.id}`} className="mt-4">
          <h2 id={`sec-${section.id}`} className="px-4 pb-2 text-meta font-semibold uppercase tracking-wide text-ink-2">
            {section.label}
          </h2>
          <ul className="divide-y divide-hairline border-y border-hairline bg-surface">
            {section.topics.map((id) => {
              if (id === PAYMENT_TOPIC) {
                const status: Status = props.payment.line ? "set" : "not_set";
                return (
                  <li key={id}>
                    <Link href={props.payment.href} className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <Row title="Payment" status={status} line={props.payment.line ?? "The team will confirm."} />
                    </Link>
                  </li>
                );
              }
              const topic = TOPICS[id];
              if (!topic) return null;
              const rule = rules[id] ?? null;
              return (
                <li key={id}>
                  <button type="button" onClick={() => setOpen(id)} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <Row title={topic.title} status={topicStatus(topic, rule)} line={spokenLine(topic, rule, niche).en} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section aria-labelledby="sec-other" className="mt-6 px-4">
        <h2 id="sec-other" className="pb-2 text-meta font-semibold uppercase tracking-wide text-ink-2">Other pages</h2>
        <Link href="/settings/areas" className="flex min-h-11 items-center justify-between rounded-xl border border-hairline bg-surface px-4 py-3 hover:bg-surface-2">
          <span>
            <span className="block text-body font-semibold text-ink">Areas and fees</span>
            <span className="block text-meta text-ink-2">Service areas</span>
          </span>
          <ChevronRightIcon aria-hidden="true" className="h-4 w-4 text-ink-2" />
        </Link>
      </section>
    </div>
  );
}

function Row({ title, status, line }: { title: string; status: Status; line: string }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-ink">{title}</span>
        <span className="mt-1 block"><Badge status={status} /></span>
        <span className="mt-1 block text-meta text-ink-2">&ldquo;{line}&rdquo;</span>
      </span>
      <ChevronRightIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-2" />
    </>
  );
}

function TopicEditor({
  topic,
  rule,
  niche,
  example,
  initialDraft,
  initialSaved,
  showErrors,
  saveAction,
  onBack,
  onSaved,
}: {
  topic: TopicDef;
  rule: Rule | null;
  niche: string;
  example?: string;
  initialDraft?: Partial<Draft> | null;
  initialSaved?: boolean;
  showErrors?: boolean;
  saveAction: SaveFn;
  onBack: () => void;
  onSaved: (rule: Rule | null) => void;
}) {
  const uid = useId();
  const [saved, setSaved] = useState(() => ({ ...draftFrom(topic, rule), ...(initialDraft ?? {}) }));
  const [draft, setDraft] = useState<Draft>(saved);
  const [tried, setTried] = useState(Boolean(showErrors));
  const [done, setDone] = useState(Boolean(initialSaved));
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);
  const errors = tried ? draftErrors(draft) : [];
  const answer = topic.answers.find((a) => a.id === draft.answer);
  const preview: Spoken = spokenLine(topic, ruleFromDraft(topic, draft), nicheById(niche));
  const fieldErr = (f: string) => errors.find((e) => e.field === f);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (tried && errors.length && !showErrors) summaryRef.current?.focus();
    // Focus the summary only when Save is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tried]);

  const set = (patch: Partial<Draft>) => {
    setDone(false);
    setServerError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = () => {
    setTried(true);
    if (draftErrors(draft).length) {
      summaryRef.current?.focus();
      return;
    }
    start(async () => {
      const res = await saveAction(topic.id, draft);
      if (!res.ok) {
        setServerError(res.error);
        return;
      }
      setSaved(draft);
      setDone(true);
      setTried(false);
      onSaved(ruleFromDraft(topic, draft));
    });
  };

  const visibleAnswers = answersFor(topic);
  const own = checkOwnWords(draft.note);
  const ownSw = checkOwnWords(draft.note_sw);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <TopBar title={topic.screenTitle} onBack={onBack} />
      {example ? <Example>{example}</Example> : null}
      <div className="flex-1 space-y-4 px-4 pb-32 pt-4">
        {errors.length ? (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-xl border-2 border-attention bg-attention-tonal p-4 text-attention outline-none">
            <p className="text-body font-semibold">⚠ Fix {errors.length} {errors.length === 1 ? "thing" : "things"} to save</p>
            <ul className="mt-2 space-y-2">
              {errors.map((e) => (
                <li key={e.summary}>
                  <a href={`#${uid}-${e.field}`} className="inline-flex min-h-11 items-center text-body underline">{e.summary}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {serverError ? <p role="alert" className="rounded-xl bg-attention-tonal p-3 text-body text-attention">⚠ {serverError}</p> : null}

        <div className="rounded-2xl border border-hairline bg-surface p-4">
          <fieldset>
            <legend className="mb-3 text-body font-semibold text-ink">{topic.question}</legend>
            <div role="radiogroup" aria-label={topic.question} className="overflow-hidden rounded-xl border border-hairline">
              {visibleAnswers.map((a, i) => {
                const on = draft.answer === a.id;
                return (
                  <label
                    key={a.id}
                    className={cx("flex min-h-[52px] cursor-pointer items-center gap-3 px-4 text-body", i > 0 && "border-t border-hairline", on && "bg-accent-tonal font-semibold")}
                  >
                    <input type="radio" name={`${uid}-answer`} value={a.id} checked={on} onChange={() => set({ answer: a.id })} className="h-5 w-5 accent-[var(--accent)]" />
                    {a.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {answer?.follow?.length ? (
            <div className="mt-4 space-y-4 border-l-2 border-hairline pl-3">
              {answer.follow.map((f) => (
                <fieldset key={f.field}>
                  <legend className="text-body font-semibold text-ink">{f.label}</legend>
                  {f.hint ? <p className="text-meta text-ink-2">{f.hint}</p> : null}
                  <div role={f.multi ? "group" : "radiogroup"} aria-label={f.label} className="mt-2 flex flex-wrap gap-2">
                    {f.options.map((o) => {
                      const cur = draft.values[f.field];
                      const on = f.multi ? Array.isArray(cur) && cur.includes(o.value) : cur === o.value;
                      return (
                        <label key={String(o.value)} className={cx("inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full border px-4 text-body has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent", on ? "border-accent bg-accent-tonal font-semibold text-accent" : "border-ink-3 bg-surface text-ink")}>
                          <input
                            type={f.multi ? "checkbox" : "radio"}
                            name={`${uid}-${f.field}`}
                            className="sr-only"
                            checked={on}
                            onChange={() => {
                              const nextVal = f.multi
                                ? on
                                  ? (cur as unknown[]).filter((x) => x !== o.value)
                                  : [...((Array.isArray(cur) ? cur : []) as unknown[]), o.value]
                                : o.value;
                              set({ values: { ...draft.values, [f.field]: nextVal as Draft["values"][string] } });
                            }}
                          />
                          {on ? <CheckIcon aria-hidden="true" className="h-4 w-4" strokeWidth={3} /> : null}
                          {o.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : null}

          {answer?.offNote ? <p className="mt-4 text-meta text-ink-2">{answer.offNote}</p> : null}
          {draft.answer === NOT_SET ? <p className="mt-4 text-meta text-ink-2">Callers hear &ldquo;The team will confirm.&rdquo; The old line is cleared.</p> : null}

          {draft.answer === CUSTOM ? (
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor={`${uid}-note`} className="text-body font-semibold text-ink">Your words</label>
                <textarea
                  id={`${uid}-note`}
                  rows={3}
                  value={draft.note}
                  onChange={(e) => set({ note: e.target.value })}
                  aria-invalid={Boolean(fieldErr("note")) || undefined}
                  aria-describedby={`${uid}-note-help`}
                  className={cx("mt-1 w-full rounded-xl border bg-surface p-3 text-body text-ink", fieldErr("note") ? "border-2 border-attention" : "border-ink-3")}
                />
                <p id={`${uid}-note-help`} className="flex justify-between text-meta">
                  {fieldErr("note") ? <span className="font-semibold text-attention">⚠ {fieldErr("note")!.inline}</span> : <span className="text-ink-2">As you&apos;d say it on a call</span>}
                  <span className={cx(own.over ? "font-semibold text-attention" : "text-ink-2")}>{own.length} / {OWN_WORDS_MAX}</span>
                </p>
              </div>
              {(
                <div>
                  <label htmlFor={`${uid}-note_sw`} className="text-body font-semibold text-ink">
                    Kiswahili <span className="font-normal text-ink-2">(optional)</span>
                  </label>
                  <textarea
                    id={`${uid}-note_sw`}
                    rows={3}
                    lang="sw"
                    value={draft.note_sw}
                    onChange={(e) => set({ note_sw: e.target.value })}
                    aria-invalid={Boolean(fieldErr("note_sw")) || undefined}
                    aria-describedby={`${uid}-note_sw-help`}
                    className={cx("mt-1 w-full rounded-xl border bg-surface p-3 text-body text-ink", fieldErr("note_sw") ? "border-2 border-attention" : "border-ink-3")}
                  />
                  <p id={`${uid}-note_sw-help`} className="flex justify-between text-meta text-ink-2">
                    {fieldErr("note_sw") ? <span className="font-semibold text-attention">⚠ {fieldErr("note_sw")!.inline}</span> : <span>Empty: &ldquo;Timu itathibitisha.&rdquo;</span>}
                    <span>{ownSw.length} / {OWN_WORDS_MAX}</span>
                  </p>
                </div>
              )}
              <ul className="space-y-1 text-meta" aria-label="Checks">
                <li className={own.over ? "text-attention" : "text-ink-2"}><span aria-hidden="true" className={cx("mr-2", !own.over && "text-ok")}>{own.over ? "✕" : "✓"}</span>{own.over ? `Cut ${own.over} letters` : "Short enough"}</li>
                <li className={own.phone || own.link || ownSw.phone || ownSw.link ? "text-attention" : "text-ink-2"}>
                  <span aria-hidden="true" className={cx("mr-2", !(own.phone || own.link || ownSw.phone || ownSw.link) && "text-ok")}>{own.phone || own.link || ownSw.phone || ownSw.link ? "✕" : "✓"}</span>
                  {own.phone || ownSw.phone ? "Remove the phone number" : own.link || ownSw.link ? "Remove the link" : "No phone or links"}
                </li>
                {own.price ? <li className="text-attention"><span aria-hidden="true" className="mr-2">!</span>Check price {own.price}</li> : null}
              </ul>
              <label id={`${uid}-checked`} className="flex min-h-11 cursor-pointer items-center gap-3 text-body">
                <input type="checkbox" checked={draft.checked} onChange={(e) => set({ checked: e.target.checked })} aria-invalid={Boolean(fieldErr("checked")) || undefined} className="h-6 w-6 accent-[var(--accent)]" />
                Checked. OK to say.
              </label>
              {fieldErr("checked") ? <p className="text-meta font-semibold text-attention">⚠ {fieldErr("checked")!.inline}</p> : null}
            </div>
          ) : null}
        </div>

        {(
          <div aria-live="polite" className="rounded-2xl border border-hairline border-l-4 border-l-brand bg-surface p-4">
            <p className="text-meta font-semibold uppercase tracking-wide text-accent">Callers hear</p>
            <p className="mt-2 text-body text-ink">&ldquo;{preview.en}&rdquo;</p>
            <p lang="sw" className="mt-1 text-body text-ink-2">&ldquo;{preview.sw}&rdquo;</p>
            {topic.hearNote ? <p className="mt-2 text-meta text-ink-2">{topic.hearNote}</p> : null}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {done && !dirty ? (
            <>
              <p role="status" className="flex-1 text-body font-semibold text-ok">✓ Saved</p>
              <button type="button" className={cx(buttonClass({ variant: "ghost", size: "lg" }), "border border-ink-3")} onClick={onBack}>Done</button>
            </>
          ) : (
            <>
              <button type="button" className={cx(buttonClass({ variant: "ghost", size: "lg" }), "border border-ink-3")} onClick={() => { setDraft(saved); setTried(false); onBack(); }} disabled={pending}>Cancel</button>
              <button type="button" className={cx(buttonClass({ variant: "primary", size: "lg" }), "flex-1")} onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
