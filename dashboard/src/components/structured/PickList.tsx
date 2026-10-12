"use client";

import { CheckIcon, ChevronRightIcon, PlusIcon } from "@heroicons/react/20/solid";
import type { ReactNode } from "react";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { cx } from "@/lib/cx";

const rowHit = `flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-start ${deskShiftClass} hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand`;

/** A settings row that opens a drawer: name, what is set now, chevron. */
export function OpenRow({
  title,
  value,
  error,
  onOpen,
  disabled,
  id,
}: {
  title: string;
  value?: ReactNode;
  error?: string | null;
  onOpen: () => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div>
      <button type="button" id={id} className={rowHit} onClick={onOpen} disabled={disabled} aria-haspopup="dialog" aria-describedby={error && id ? `${id}-error` : undefined}>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-ink">{title}</span>
          {value ? <span className="mt-0.5 block text-meta text-ink-2 [overflow-wrap:anywhere]">{value}</span> : null}
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
      </button>
      {error ? (
        <p id={id ? `${id}-error` : undefined} role="alert" className="px-4 pb-2.5 text-meta text-attention">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The "Add ..." row at the bottom of a grouped list. */
export function AddRow({ label, onOpen, disabled }: { label: string; onOpen: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={cx(rowHit, "text-accent")} onClick={onOpen} disabled={disabled} aria-haspopup="dialog">
      <PlusIcon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-body font-medium">{label}</span>
    </button>
  );
}

/**
 * Inline list of choices with a check, for use inside a Sheet. Single choice has radio
 * semantics; multiple has checkbox semantics. Every row is a 44px tap target.
 */
export function CheckList<T extends string>({
  label,
  options,
  value,
  onChange,
  multiple = false,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string; detail?: string }>;
  value: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-meta font-medium text-ink">{label}</p>
      <div role={multiple ? "group" : "radiogroup"} aria-label={label} className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => {
                if (multiple) onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id]);
                else onChange([o.id]);
              }}
              className={cx(rowHit, "px-3")}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">{o.label}</span>
                {o.detail ? <span className="mt-0.5 block text-meta text-ink-2">{o.detail}</span> : null}
              </span>
              <span
                aria-hidden
                className={cx(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                  on ? "border-accent bg-accent text-accent-on" : "border-ink-3 bg-surface",
                  multiple && "rounded-md",
                )}
              >
                {on ? <CheckIcon className="size-4" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** What the Business Assistant will say, under an editor. */
export function CallersHear({ text, empty = "Nothing yet." }: { text: string; empty?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3" aria-live="polite">
      <p className="text-meta font-medium text-ink-2">Callers hear</p>
      <p className="mt-1 text-body text-ink [overflow-wrap:anywhere]">{text || empty}</p>
    </div>
  );
}
