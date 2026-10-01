"use client";

import { useEffect, useRef } from "react";
import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";

export function scrollDeskWellToTop() {
  if (typeof document === "undefined") return;
  const well = document.querySelector("main.overflow-y-auto");
  if (!(well instanceof HTMLElement) || well.scrollTop === 0) return;
  well.scrollTo({ top: 0 });
}

export function EndlessSentinel({
  hasMore,
  loading,
  loaded,
  hold = false,
  onLoad,
}: {
  hasMore: boolean;
  loading: boolean;
  loaded: number;
  /** After a failed page, wait until the sentinel leaves and comes back. */
  hold?: boolean;
  onLoad: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading) return;
    const root = node.closest("main");
    let seenGap = !hold;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((entry) => entry.isIntersecting);
        if (!hit) {
          if (hold) seenGap = true;
          return;
        }
        if (!seenGap) return;
        seenGap = false;
        onLoadRef.current();
      },
      {
        root: root instanceof HTMLElement ? root : null,
        rootMargin: "240px 0px",
      }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loading, loaded, hold]);

  if (!hasMore && !loading) return null;

  return (
    <div
      ref={ref}
      className={
        loading
          ? "flex min-h-11 items-center justify-center"
          : "h-px w-full"
      }
      aria-live="polite"
    >
      {loading ? (
        <>
          <span aria-hidden="true" className={pendingSpinnerInkClass} />
          <span className="sr-only">Loading</span>
        </>
      ) : null}
    </div>
  );
}
