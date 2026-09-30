import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "tonal" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[background-color,color,transform,opacity] duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-on hover:bg-accent-hover active:bg-accent-active",
  tonal: "bg-accent-tonal text-accent hover:bg-accent-tonal/80 active:bg-accent-tonal/70",
  ghost: "bg-transparent text-ink hover:bg-surface-2 active:bg-surface-2/80",
  danger: "bg-attention-tonal text-attention hover:bg-attention-tonal/80",
};

/* Heights: sm 36 (44 hit via the row it sits in), md 44, lg 52. */
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 min-w-9 px-3 text-meta",
  md: "h-11 min-w-11 px-4 text-body",
  lg: "h-13 min-w-13 px-5 text-body",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}) {
  return cx(base, variants[variant], sizes[size], block && "w-full", className);
}

export const pendingDotClass =
  "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Shows a spinner in place of the leading slot and disables the control. */
  pending?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function Button({
  variant,
  size,
  block,
  pending = false,
  leading,
  trailing,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={buttonClass({ variant, size, block, className })}
      {...rest}
    >
      {pending ? <span aria-hidden="true" className={pendingDotClass} /> : leading}
      {children}
      {trailing}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function ButtonLink({
  variant,
  size,
  block,
  leading,
  trailing,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, block, className })} {...rest}>
      {leading}
      {children}
      {trailing}
    </Link>
  );
}
