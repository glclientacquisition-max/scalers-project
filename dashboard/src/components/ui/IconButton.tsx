"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { pendingDotClass } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";

export type IconButtonTone = "neutral" | "accent" | "whatsapp" | "ok" | "attention" | "primary";
export type IconButtonSize = "sm" | "md";

const base =
  "inline-flex shrink-0 select-none items-center justify-center rounded-full transition-[background-color,color,transform,opacity] duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.96] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50";

const tones: Record<IconButtonTone, string> = {
  neutral: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  accent: "bg-accent-tonal text-accent hover:bg-accent-tonal/80",
  whatsapp: "bg-ok-tonal text-whatsapp-deep hover:bg-ok-tonal/80",
  ok: "bg-ok-tonal text-ok hover:bg-ok-tonal/80",
  attention: "bg-attention-tonal text-attention hover:bg-attention-tonal/80",
  primary: "bg-accent text-accent-on hover:bg-accent-hover active:bg-accent-active",
};

/* Both sizes are a 44px disc. `sm` only shrinks the glyph for dense rows. */
const sizes: Record<IconButtonSize, string> = {
  sm: "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5",
  md: "h-11 w-11 [&>svg]:h-6 [&>svg]:w-6",
};

export function iconButtonClass({
  tone = "neutral",
  size = "md",
  className,
}: {
  tone?: IconButtonTone;
  size?: IconButtonSize;
  className?: string;
} = {}) {
  return cx(base, tones[tone], sizes[size], className);
}

type Common = {
  /** Visible on hover and focus, read by screen readers. Required. */
  label: string;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  children: ReactNode;
};

type IconButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
    pending?: boolean;
  };

export function IconButton({
  label,
  tone,
  size,
  pending = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        type={type}
        aria-label={label}
        aria-busy={pending || undefined}
        disabled={disabled || pending}
        className={iconButtonClass({ tone, size, className })}
        {...rest}
      >
        {pending ? <span aria-hidden="true" className={pendingDotClass} /> : children}
      </button>
    </Tooltip>
  );
}

type IconButtonLinkProps = Common & Omit<ComponentProps<typeof Link>, "children" | "aria-label">;

export function IconButtonLink({ label, tone, size, className, children, ...rest }: IconButtonLinkProps) {
  return (
    <Tooltip label={label}>
      <Link aria-label={label} className={iconButtonClass({ tone, size, className })} {...rest}>
        {children}
      </Link>
    </Tooltip>
  );
}

/** Plain anchor for `tel:` and `https://wa.me` targets, which must not go through the Next router. */
export function IconButtonAnchor({
  label,
  tone,
  size,
  className,
  children,
  ...rest
}: Common & Omit<ComponentProps<"a">, "children" | "aria-label">) {
  return (
    <Tooltip label={label}>
      <a aria-label={label} className={iconButtonClass({ tone, size, className })} {...rest}>
        {children}
      </a>
    </Tooltip>
  );
}
