"use client";

import { useState } from "react";
import { CheckIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { Sheet } from "@/components/ui/Sheet";
import { deskShiftClass } from "@/components/ui/deskChrome";

/**
 * A short pick. The closed row shows the current value. The list is the same
 * bottom drawer as every other overlay, so the finger can drag it away.
 * Long settings forms stay pages.
 */
export function ChoiceSheet<T extends string>({
  id,
  title,
  value,
  options,
  onChange,
  placeholder = "Choose",
  label,
  rowLabel,
}: {
  id?: string;
  title: string;
  value: T | "";
  options: readonly { value: T; label: string; detail?: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
  label?: string;
  /** When set, this control is the whole settings row: name, current value, chevron. */
  rowLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((opt) => opt.value === value);
  const valueText = current?.label || placeholder;

  return (
    <>
      <button
        type="button"
        id={id}
        aria-label={rowLabel ? undefined : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          rowLabel
            ? `flex min-h-11 w-full items-center gap-3 px-4 text-start ${deskShiftClass} hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand`
            : `flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-start text-body text-ink ${deskShiftClass} hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`
        }
      >
        {rowLabel ? (
          <>
            <span className="shrink-0 text-body font-medium text-ink">{rowLabel}</span>
            <span className={`min-w-0 flex-1 truncate text-end text-body ${current ? "text-ink-2" : "text-ink-3"}`}>
              {valueText}
            </span>
          </>
        ) : (
          <span className={current ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-ink-3"}>
            {valueText}
          </span>
        )}
        <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
      </button>
      <Sheet
        open={open}
        title={title}
        onOpenChange={setOpen}
      >
        <ul>
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-start ${deskShiftClass} hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${selected ? "bg-accent-tonal" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{opt.label}</span>
                    {opt.detail ? (
                      <span className="mt-0.5 block truncate text-meta text-ink-2">{opt.detail}</span>
                    ) : null}
                  </span>
                  {selected ? <CheckIcon className="size-5 shrink-0 text-accent" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
