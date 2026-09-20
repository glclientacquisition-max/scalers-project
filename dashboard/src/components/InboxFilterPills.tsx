"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { deskShiftClass } from "@/components/ui/deskChrome";

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
      <ul className="-mx-1 flex flex-nowrap snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                className={[
                  "inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium",
                  deskShiftClass,
                  "focus:outline-none focus:ring-2 focus:ring-[#0096FF]",
                  isActive
                    ? "bg-[#005CCC] text-white"
                    : "bg-surface-muted text-ink hover:bg-[#0096FF]/10",
                ].join(" ")}
              >
                {item.label}
                {typeof item.count === "number" ? (
                  <span
                    className={[
                      "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                      isActive ? "bg-white/20 text-white" : "bg-surface text-ink-soft",
                    ].join(" ")}
                  >
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
