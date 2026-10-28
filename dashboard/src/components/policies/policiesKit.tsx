"use client";

import { CheckIcon } from "@heroicons/react/20/solid";
import type { ReactNode, RefObject } from "react";
import { cx } from "@/lib/cx";
import { deskShiftClass, pendingSpinnerInkClass } from "@/components/ui/deskChrome";

/**
 * Small pieces for Settings › Policies. Native radios and checkboxes inside a
 * fieldset with a legend, so arrow keys, labels and screen readers work without
 * extra script. Selected rows carry a check mark and bolder text, never colour alone.
 */

const rowClass = cx(
  "flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2.5 text-start hover:bg-surface-2",
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-brand",
  deskShiftClass,
);

function Mark({ on, square }: { on: boolean; square?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex size-6 shrink-0 items-center justify-center border-2",
        square ? "rounded-md" : "rounded-full",
        on ? "border-accent bg-accent text-accent-on" : "border-ink-2 bg-surface",
      )}
    >
      {on ? <CheckIcon className="size-4" /> : null}
    </span>
  );
}

export type ChoiceOption<T extends string> = { id: T; label: string; detail?: string };

/** One answer from a short list. Rows are 48px; the whole row is the label. */
export function RadioFieldset<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  hideLegend = false,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  hideLegend?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={hideLegend ? "sr-only" : "mb-1.5 text-meta font-medium text-ink"}>{legend}</legend>
      <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {options.map((o) => {
          const on = value === o.id;
          return (
            <label key={o.id} className={rowClass} data-choice={o.id} data-on={on ? "" : undefined}>
              <input type="radio" name={name} value={o.id} checked={on} onChange={() => onChange(o.id)} className="sr-only" />
              <span className="min-w-0 flex-1">
                <span className={cx("block text-body text-ink", on && "font-semibold")}>{o.label}</span>
                {o.detail ? <span className="mt-0.5 block text-meta text-ink-2">{o.detail}</span> : null}
              </span>
              <Mark on={on} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Any number of answers from a short list. */
export function CheckFieldset<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  hint,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<ChoiceOption<T>>;
  value: readonly T[];
  onChange: (next: T[]) => void;
  hint?: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-meta font-medium text-ink">
        {legend}
        {hint ? <span className="font-normal text-ink-2"> · {hint}</span> : null}
      </legend>
      <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <label key={o.id} className={rowClass} data-choice={o.id} data-on={on ? "" : undefined}>
              <input
                type="checkbox"
                name={name}
                value={o.id}
                checked={on}
                onChange={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
                className="sr-only"
              />
              <span className="min-w-0 flex-1">
                <span className={cx("block text-body text-ink", on && "font-semibold")}>{o.label}</span>
                {o.detail ? <span className="mt-0.5 block text-meta text-ink-2">{o.detail}</span> : null}
              </span>
              <Mark on={on} square />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Short values (24 hrs, 7 days) as one row of chips. Radio semantics; 44px each. */
export function ChipFieldset<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-meta font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={String(o.value)}
              data-on={on ? "" : undefined}
              className={cx(
                "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-body",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface",
                deskShiftClass,
                on ? "border-accent bg-accent font-semibold text-accent-on" : "border-hairline bg-surface text-ink hover:bg-surface-2",
              )}
            >
              <input type="radio" name={name} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
              {on ? <CheckIcon aria-hidden className="-ms-1 size-4" /> : null}
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export type CardSaveState =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; undo?: () => void }
  | { state: "error"; error: string; retry?: () => void };

/**
 * A Policies card: heading, a quiet save status (announced politely), the body, and a
 * failure line with Try again. The heading takes focus when a link jumps here.
 */
export function PolicyCard({
  id,
  title,
  status,
  headingRef,
  highlight = false,
  children,
  footer,
}: {
  id: string;
  title: string;
  status: CardSaveState;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  highlight?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="min-w-0 scroll-mt-24 space-y-1.5" data-policies-card={id}>
      <div className="flex min-h-11 items-center justify-between gap-3 px-1">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="rounded-md text-meta font-medium text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {title}
        </h2>
        <SaveStatus status={status} label={title} />
      </div>
      <div
        className={cx(
          "divide-y divide-hairline overflow-hidden rounded-2xl border bg-surface",
          deskShiftClass,
          highlight ? "border-accent ring-2 ring-accent/40" : "border-hairline",
        )}
      >
        {children}
      </div>
      {footer}
      {status.state === "error" ? (
        <div className="flex flex-wrap items-center gap-x-3 px-1" data-save-error="">
          <p className="min-w-0 flex-1 text-body text-warn" role="alert">
            {status.error}
          </p>
          {status.retry ? (
            <button
              type="button"
              onClick={status.retry}
              className="min-h-11 shrink-0 rounded-xl px-2 text-body font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Saving / Saved, with Undo beside Saved for a few seconds. Text, not only an icon. */
export function SaveStatus({ status, label }: { status: CardSaveState; label: string }) {
  return (
    <span className="inline-flex min-h-11 shrink-0 items-center gap-1">
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-meta text-ink-2" data-save-status={status.state}>
        {status.state === "saving" ? (
          <>
            <span aria-hidden className={pendingSpinnerInkClass} />
            Saving
          </>
        ) : status.state === "saved" ? (
          <>
            <CheckIcon aria-hidden className="size-4 text-ok" />
            Saved
          </>
        ) : null}
      </span>
      {status.state === "saved" && status.undo ? (
        <button
          type="button"
          onClick={status.undo}
          aria-label={`Undo ${label.toLowerCase()} change`}
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-meta font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Undo
        </button>
      ) : null}
    </span>
  );
}

/** A rule or setting as one plain sentence with a single Change. */
export function SentenceRow({
  title,
  sentence,
  suggested = false,
  onChange,
  canEdit,
  changeLabel = "Change",
  id,
  children,
}: {
  title: string;
  sentence: ReactNode;
  suggested?: boolean;
  onChange?: () => void;
  canEdit: boolean;
  changeLabel?: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3" data-sentence-row={id} data-suggested={suggested ? "" : undefined}>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-body text-ink-2 [overflow-wrap:anywhere]">
          {suggested ? <span className="font-medium text-ink">Not set. Suggested: </span> : null}
          {sentence}
        </p>
        {children}
      </div>
      {canEdit && onChange ? (
        <button
          type="button"
          id={id ? `${id}-change` : undefined}
          onClick={onChange}
          aria-haspopup="dialog"
          aria-label={`${changeLabel} ${title.toLowerCase()}`}
          className={cx(
            "-me-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-3 text-body font-medium text-accent hover:bg-surface-2",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            deskShiftClass,
          )}
        >
          {changeLabel}
        </button>
      ) : null}
    </div>
  );
}

/** The live preview inside a Change sheet. Not a live region: the sheet is already focused. */
export function SheetHear({ text, empty }: { text: string; empty?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3" data-sheet-hear="">
      <p className="text-meta font-medium text-ink-2">Callers hear</p>
      <p className="mt-1 text-body text-ink [overflow-wrap:anywhere]">{text || empty || "Nothing yet."}</p>
    </div>
  );
}
