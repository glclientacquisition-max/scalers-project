"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { brandAssets } from "@/components/brand/assets";

type Size = "sm" | "md" | "lg";

/** Average, readable chrome sizes — icon stays legible beside the name. */
const SIZE: Record<
  Size,
  { box: string; img: string; type: string; gap: string; width: number; height: number; context: string }
> = {
  sm: {
    box: "h-8 w-8",
    img: "h-8 w-8",
    type: "text-lg leading-none",
    gap: "gap-2",
    width: 32,
    height: 32,
    context: "text-[10px]",
  },
  md: {
    box: "h-10 w-10",
    img: "h-10 w-10",
    type: "text-2xl leading-none",
    gap: "gap-3",
    width: 40,
    height: 40,
    context: "text-[11px]",
  },
  lg: {
    box: "h-12 w-12",
    img: "h-12 w-12",
    type: "text-3xl leading-none",
    gap: "gap-3.5",
    width: 48,
    height: 48,
    context: "text-xs",
  },
};

type BrandLockupProps = {
  href?: string | null;
  name?: string;
  context?: string;
  onDark?: boolean;
  size?: Size;
  className?: string;
  priority?: boolean;
};

/**
 * Scalers lockup: transparent icon + product name.
 * Use in headers / colored chrome so the mark overlays without a white plate.
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
      <span
        className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${s.box}`}
        aria-hidden
      >
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
      <span className="min-w-0 flex flex-col justify-center gap-0.5">
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
              "truncate font-medium uppercase tracking-[0.14em]",
              s.context,
              onDark ? "text-sky-200/80" : "text-ink-soft",
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
 * Auth / entry surfaces: large lockup (transparent mark + Scalers).
 * Falls back cleanly; optional full logo file when `variant="full"`.
 */
export function BrandWordmark({
  href = "/",
  className = "",
  priority = false,
  context,
  variant = "lockup",
}: {
  href?: string;
  className?: string;
  priority?: boolean;
  context?: string;
  variant?: "lockup" | "full";
}) {
  const [failed, setFailed] = useState(false);

  if (variant === "lockup" || failed) {
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
        width={320}
        height={128}
        priority={priority}
        className="h-14 w-auto max-w-[280px] object-contain object-left sm:h-16"
        onError={() => setFailed(true)}
      />
      {context ? (
        <span className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-soft">
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
