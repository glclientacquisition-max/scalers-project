"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** iOS inset grouped list: one rounded surface, hairline rows. */
export function Group({ title, footer, children, className }: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-6", className)}>
      {title ? <h2 className="mb-2 px-4 text-meta font-medium text-ink-2">{title}</h2> : null}
      <div className="divide-y divide-hairline overflow-hidden rounded-2xl bg-surface">{children}</div>
      {footer ? <div className="mt-2 px-4 text-meta text-ink-2">{footer}</div> : null}
    </section>
  );
}

/** Exclusive choice as a list with a trailing check (iOS settings pattern). */
export function ChoiceList<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; title: string; detail?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="divide-y divide-hairline overflow-hidden rounded-2xl bg-surface">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt.value)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">{opt.title}</span>
              {opt.detail ? <span className="mt-0.5 block text-meta text-ink-2">{opt.detail}</span> : null}
            </span>
            <svg aria-hidden viewBox="0 0 20 20" className={cx("h-5 w-5 shrink-0 text-accent", on ? "opacity-100" : "opacity-0")}>
              <path fill="currentColor" d="M7.6 13.6 4.3 10.3l-1.1 1.1 4.4 4.4 9.2-9.2-1.1-1.1z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-meta text-attention">
      {message}
    </p>
  );
}

/** Small text button used for add/remove/secondary actions. 44px hit. */
export function TextButton({ children, onClick, tone = "accent", label, disabled }: { children: ReactNode; onClick: () => void; tone?: "accent" | "danger" | "muted"; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={cx(
        "inline-flex min-h-11 items-center rounded-lg px-2 text-meta font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        tone === "accent" && "text-accent-deep hover:bg-accent-soft",
        tone === "danger" && "text-attention hover:bg-attention-tonal",
        tone === "muted" && "text-ink-2 hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "block w-full min-h-11 rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-body text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-brand/40 aria-[invalid=true]:border-attention";
