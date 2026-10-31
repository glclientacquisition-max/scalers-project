"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type SegmentedItem = {
  key: string;
  label: ReactNode;
  count?: number;
  href?: string;
  active?: boolean;
  disabled?: boolean;
};

const itemBase =
  "relative inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap px-3 text-body font-medium transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-opacity after:duration-fast";

const itemState = (active: boolean) =>
  active
    ? "text-ink after:bg-brand after:opacity-100"
    : "text-ink-2 hover:text-ink after:bg-brand after:opacity-0";

function Count({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={cx("text-meta tabular-nums", active ? "text-ink-2" : "text-ink-3")}>{n}</span>
  );
}

/**
 * Underline tabs for filters and views. Links when `href` is set (URL-driven filters),
 * buttons with `onSelect` otherwise. Scrolls sideways on phone with no fade mask.
 */
export function Segmented({
  items,
  onSelect,
  onNavigate,
  label,
  className,
  flush = false,
}: {
  items: SegmentedItem[];
  onSelect?: (key: string) => void;
  /**
   * Link mode: called on a plain click. Return true when the parent handled it
   * on the client (the Link's own navigation is then skipped).
   */
  onNavigate?: (key: string) => boolean;
  /** Accessible name for the group. */
  label: string;
  className?: string;
  /** No side inset and no own rule, so a parent hairline can run the full width. */
  flush?: boolean;
}) {
  const asLinks = items.every((item) => item.href);
  const activeKey = items.find((item) => item.active)?.key ?? null;
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !activeKey) return;
    const node = nav.querySelector("[data-segmented-active]");
    if (!(node instanceof HTMLElement)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const left = node.offsetLeft - (nav.clientWidth - node.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [activeKey, label]);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      data-segmented={label}
      className={cx(
        "flex min-w-0 max-w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        flush ? "w-auto" : "-mx-4 w-full border-b border-hairline px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0",
        className,
      )}
    >
      {items.map((item) => {
        const active = Boolean(item.active);
        if (asLinks && item.href) {
          return (
            <Link
              key={item.key}
              href={item.href}
              // Default prefetch (shell only). A full `prefetch` here rendered
              // every Inbox tab, each a full inbox load, on every visit.
              data-segmented-active={active ? "" : undefined}
              aria-current={active ? "page" : undefined}
              aria-disabled={item.disabled || undefined}
              onClick={(event) => {
                if (!onNavigate) return;
                if (event.defaultPrevented || event.button !== 0) return;
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (onNavigate(item.key)) event.preventDefault();
              }}
              className={cx(itemBase, itemState(active), item.disabled && "pointer-events-none opacity-50")}
            >
              {item.label}
              {typeof item.count === "number" ? <Count n={item.count} active={active} /> : null}
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            data-segmented-active={active ? "" : undefined}
            aria-pressed={active}
            disabled={item.disabled}
            onClick={onSelect ? () => onSelect(item.key) : undefined}
            className={cx(itemBase, itemState(active), "disabled:opacity-50")}
          >
            {item.label}
            {typeof item.count === "number" ? <Count n={item.count} active={active} /> : null}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Compact exclusive choice (Appearance, sort). One box, filled thumb behind the active option.
 */
export function SegmentedControl({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: Array<{ value: string; label: ReactNode; icon?: ReactNode }>;
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface-2 p-1", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.value)}
            className={cx(
              "inline-flex min-h-11 lg:min-h-9 [@media(pointer:coarse)]:min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-meta font-medium transition-[background-color,color,box-shadow] duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&>svg]:h-4 [&>svg]:w-4",
              active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(10_25_47/0.12)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
