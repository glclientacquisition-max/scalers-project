"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  deskRateCardClass,
  deskRateCardCountClass,
  deskRateCardRowClass,
} from "@/components/ui/deskChrome";

export type InboxFilterPillItem = {
  id: string;
  label: string;
  href: string;
  count?: number;
};

export function InboxFilterPills({
  label,
  items,
  active,
}: {
  label: string;
  items: readonly InboxFilterPillItem[];
  active: string;
}) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const node = activeRef.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [active]);

  return (
    <nav aria-label={label} className="relative">
      <ul className={deskRateCardRowClass}>
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li
              key={item.id}
              ref={isActive ? activeRef : undefined}
              className="snap-start shrink-0"
            >
              <Link
                href={item.href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={deskRateCardClass(isActive)}
              >
                {item.label}
                {typeof item.count === "number" ? (
                  <span className={deskRateCardCountClass(isActive)}>
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent"
      />
    </nav>
  );
}
