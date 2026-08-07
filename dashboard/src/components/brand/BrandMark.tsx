"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { brandAssets } from "@/components/brand/assets";

type BrandMarkProps = {
  href?: string;
  label?: string;
  invert?: boolean;
  className?: string;
  priority?: boolean;
};

/**
 * Scalers mark for chrome. Uses PNG icon when available, SVG fallback otherwise.
 */
export function BrandMark({
  href = "/",
  label = "Sauti Desk",
  invert = false,
  className = "",
  priority = false,
}: BrandMarkProps) {
  const [src, setSrc] = useState(brandAssets.icon);

  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className={[
          "relative inline-flex h-8 w-8 shrink-0 overflow-hidden",
          invert ? "rounded-md bg-white/5" : "",
        ].join(" ")}
      >
        <Image
          src={src}
          alt=""
          width={32}
          height={32}
          priority={priority}
          className="h-8 w-8 object-contain"
          onError={() => setSrc(brandAssets.iconFallback)}
        />
      </span>
      <span
        className={[
          "font-display text-xl tracking-tight sm:text-2xl",
          invert ? "text-white" : "text-brand-900",
        ].join(" ")}
      >
        {label}
      </span>
    </span>
  );

  if (!href) return content;
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-md focus-visible:outline-none focus-visible:shadow-focus"
    >
      {content}
    </Link>
  );
}

export function BrandWordmark({
  href = "/",
  className = "",
  priority = false,
}: {
  href?: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  const inner = failed ? (
    <BrandMark href={undefined} label="Sauti Desk" className={className} priority={priority} />
  ) : (
    <Image
      src={brandAssets.logoFull}
      alt="Scalers"
      width={180}
      height={40}
      priority={priority}
      className={`h-9 w-auto object-contain sm:h-10 ${className}`}
      onError={() => setFailed(true)}
    />
  );

  if (!href) return inner;
  return (
    <Link
      href={href}
      className="inline-block rounded-md focus-visible:outline-none focus-visible:shadow-focus"
    >
      {inner}
    </Link>
  );
}
