"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Instant path for motion primitives. False until mounted, then tracks the
 * media query. When true, skip enter/exit classes and render the settled state.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** Same as `usePrefersReducedMotion`. Spec name: gate off motion when set. */
export function useReducedMotionGate(): boolean {
  return usePrefersReducedMotion();
}
