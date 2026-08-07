"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { brandAssets } from "@/components/brand/assets";

type Size = "sm" | "md" | "lg";

const SIZE: Record<
  Size,
  { box: string; img: string; type: string; gap: string; width: number; height: number; context: string }
> = {
  sm: {
    box: "h-7 w-7",
    img: "h-7 w-7",
    type: "text-lg leading-none",
    gap: "gap-2",
    width: 28,
    height: 28,
    context: "text-[10px]",
  },
  md: {
    box: "h-9 w-9",
    img: "h-9 w-9",
    type: "text-xl leading-none sm:text-2xl",
    gap: "gap-2.5",
    width: 36,
    height: 36,
    context: "text-[11px]",
  },
  lg: {
    box: "h-11 w-11",
    img: "h-11 w-11",
    type: "text-2xl leading-none sm:text-3xl",
    gap: "gap-3",
    width: 44,
    height: 44,
    context: "text-xs",
  },
};

type BrandLockupProps = {
  href?: string | null;
  name?: string;
  /** Line under the product name (business name, Super Admin, etc.). */
  context?: string;
  onDark?: boolean;
  size?: Size;
  className?: string;
  priority?: boolean;
};

/**
 * Official Scalers lockup: transparent icon + product name.
 * Prefer on headers and colored surfaces so the mark overlays without a white plate.
 */
export function BrandLockup({
  href = "/",
  name = "Scalers",
  context,
  onDark = false,
  size = "md",
  className = "",
  priority = false,
}: BrandLockupProps) {
  const [useFallback, setUseFallback] = useState(false);
  const s = SIZE[size];

  const mark = (
    <span className={`inline-flex items-center ${s.gap} min-w-0 ${className}`}>
      <span className={`relative inline-flex shrink-0 items-center justify-center ${s.box}`}>
        {useFallback ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brandAssets.iconFallback}
            alt=""
            width={s.width}
            height={s.height}
            className={`${s.img} object-contain`}
          />
        ) : (
          <Image
            src={brandAssets.iconTransparent}
            alt=""
            width={s.width}
            height={s.height}
            priority={priority}
            className={`${s.img} object-contain object-center`}
            onError={() => setUseFallback(true)}
          />
        )}
      </span>
      <span className="min-w-0 flex flex-col justify-center">
        <span
          className={[
            "font-display tracking-tight",
            s.type,
            onDark ? "text-white" : "text-brand-900",
          ].join(" ")}
        >
          {name}
        </span>
        {context ? (
          <span
            className={[
              "mt-0.5 truncate font-medium uppercase tracking-[0.14em]",
              s.context,
              onDark ? "text-brand-200/75" : "text-ink-soft",
            ].join(" ")}
          >
            {context}
          </span>
        ) : null}
      </span>
    </span>
  );

  if (!href) return mark;
  return (
    <Link
      href={href}
      className="inline-flex min-w-0 rounded-md focus-visible:outline-none focus-visible:shadow-focus"
      aria-label={context ? `${name} · ${context}` : name}
    >
      {mark}
    </Link>
  );
}

/** Alias for older imports. */
export function BrandMark(props: {
  href?: string;
  label?: string;
  invert?: boolean;
  className?: string;
  priority?: boolean;
}) {
  return (
    <BrandLockup
      href={props.href}
      name={props.label ?? "Scalers"}
      onDark={props.invert}
      className={props.className}
      priority={props.priority}
    />
  );
}

/**
 * Auth / marketing hero: full logo file when available, else transparent lockup.
 */
export function BrandWordmark({
  href = "/",
  className = "",
  priority = false,
  context,
}: {
  href?: string;
  className?: string;
  priority?: boolean;
  context?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <BrandLockup
        href={href}
        name="Scalers"
        context={context}
        size="lg"
        className={className}
        priority={priority}
      />
    );
  }

  const img = (
    <span className={`inline-flex flex-col ${className}`}>
      <Image
        src={brandAssets.logoFull}
        alt="Scalers"
        width={360}
        height={140}
        priority={priority}
        className="h-12 w-auto max-w-[220px] object-contain object-left sm:h-14 sm:max-w-[260px]"
        onError={() => setFailed(true)}
      />
      {context ? (
        <span className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
          {context}
        </span>
      ) : null}
    </span>
  );

  if (!href) return img;
  return (
    <Link
      href={href}
      className="inline-block rounded-md focus-visible:outline-none focus-visible:shadow-focus"
      aria-label={context ? `Scalers · ${context}` : "Scalers"}
    >
      {img}
    </Link>
  );
}
