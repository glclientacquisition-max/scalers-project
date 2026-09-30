import { ChevronDownIcon } from "@heroicons/react/20/solid";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";

export const controlClass =
  "block w-full min-h-11 rounded-xl border border-hairline bg-surface px-3 py-2.5 text-body text-ink shadow-none outline-none transition-[border-color,box-shadow] duration-fast ease-out placeholder:text-ink-3 hover:border-ink-3 focus:border-accent focus:ring-2 focus:ring-brand/40 disabled:opacity-50 aria-[invalid=true]:border-attention aria-[invalid=true]:focus:ring-attention/30";

/**
 * Label, control, hint, error. Wires ids so the control is named and described.
 * Pass the control as `children` using the render prop so it receives the ids.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    required?: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="mb-1.5 block text-meta font-medium text-ink">
        {label}
        {required ? <span className="text-attention"> *</span> : null}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required,
      })}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-meta text-attention">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-meta text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, className)} {...rest} />;
}

/**
 * Grows with content. `rows` is the starting height and is chosen per field.
 * `field-sizing: content` does the work where supported; the max keeps a paste from taking the screen.
 */
export function Textarea({
  className,
  rows = 2,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cx(controlClass, "min-h-[4.25rem] max-h-[50dvh] resize-y [field-sizing:content]", className)}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cx(controlClass, "appearance-none pe-10", className)} {...rest}>
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2"
      />
    </span>
  );
}
