"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";
import { controlClass } from "@/components/ui/Field";

/** Count shows from 80% of the limit, so short answers stay quiet. */
export const COUNT_FROM = 0.8;

export function nearLimit(length: number, max?: number): boolean {
  return typeof max === "number" && max > 0 && length >= Math.floor(max * COUNT_FROM);
}

export function CharCount({ id, length, max }: { id?: string; length: number; max?: number }) {
  if (!nearLimit(length, max)) return null;
  const over = length >= (max as number);
  return (
    <p id={id} aria-live="polite" className={cx("text-meta tabular-nums", over ? "text-attention" : "text-ink-2")}>
      {(max as number) - length} left
    </p>
  );
}

const supportsFieldSizing = () =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/**
 * Grows with its content. `field-sizing: content` where the browser has it; otherwise it
 * measures scrollHeight on every change. The max keeps a paste from taking the screen.
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoGrowTextarea({ className, onInput, rows = 2, ...rest }, forwarded) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const setRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        inner.current = el;
        if (typeof forwarded === "function") forwarded(el);
        else if (forwarded) forwarded.current = el;
      },
      [forwarded],
    );
    const fit = useCallback(() => {
      const el = inner.current;
      if (!el || supportsFieldSizing()) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }, []);
    useEffect(fit, [fit, rest.value]);
    return (
      <textarea
        ref={setRef}
        rows={rows}
        onInput={(e) => {
          fit();
          onInput?.(e);
        }}
        className={cx("resize-none overflow-y-auto [field-sizing:content] max-h-[50dvh] leading-relaxed", className)}
        {...rest}
      />
    );
  },
);

type Common = {
  id: string;
  label: ReactNode;
  /** Hidden label, for repeated rows that already have a visible heading. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
};

function describe(id: string, hint: unknown, error: unknown, count: boolean) {
  return [error ? `${id}-error` : null, hint ? `${id}-hint` : null, count ? `${id}-count` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

function Foot({ id, hint, error, length, max }: { id: string; hint?: ReactNode; error?: string | null; length: number; max?: number }) {
  const count = nearLimit(length, max);
  if (!error && !hint && !count) return null;
  return (
    <div className="mt-1.5 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-meta text-attention">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="text-meta text-ink-2">
            {hint}
          </p>
        ) : null}
      </div>
      <CharCount id={`${id}-count`} length={length} max={max} />
    </div>
  );
}

function Label({ id, label, hideLabel, required }: { id: string; label: ReactNode; hideLabel?: boolean; required?: boolean }) {
  return (
    <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1.5 block text-meta font-medium text-ink"}>
      {label}
      {required ? <span className="text-attention"> *</span> : null}
    </label>
  );
}

/** Kit text input: visible label, 44px control, token focus ring, error and near-limit count below. */
export function TextField({
  id,
  label,
  hideLabel,
  hint,
  error,
  className,
  value,
  maxLength,
  required,
  ...rest
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  const length = String(value ?? "").length;
  return (
    <div className={cx("min-w-0", className)}>
      <Label id={id} label={label} hideLabel={hideLabel} required={required} />
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe(id, hint, error, nearLimit(length, maxLength))}
        className={controlClass}
        {...rest}
      />
      <Foot id={id} hint={hint} error={error} length={length} max={maxLength} />
    </div>
  );
}

/** Kit textarea: same as TextField, grows with the answer. */
export function TextAreaField({
  id,
  label,
  hideLabel,
  hint,
  error,
  className,
  value,
  maxLength,
  required,
  rows = 3,
  ...rest
}: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">) {
  const length = String(value ?? "").length;
  return (
    <div className={cx("min-w-0", className)}>
      <Label id={id} label={label} hideLabel={hideLabel} required={required} />
      <AutoGrowTextarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe(id, hint, error, nearLimit(length, maxLength))}
        className={cx(controlClass, "min-h-[5.5rem]")}
        {...rest}
      />
      <Foot id={id} hint={hint} error={error} length={length} max={maxLength} />
    </div>
  );
}

/**
 * iOS grouped card: one rounded surface, fields stacked as rows with a hairline between.
 * `title` and `action` sit in the card header (e.g. "Question 2" and Remove).
 */
export function FieldCard({
  title,
  action,
  children,
  className,
  ...rest
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div className={cx("rounded-2xl border border-hairline bg-surface p-4", className)} {...rest}>
      {title || action ? (
        <div className="-mt-1 mb-3 flex min-h-11 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-meta font-medium text-ink-2">{title}</p>
          {action}
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </div>
  );
}
