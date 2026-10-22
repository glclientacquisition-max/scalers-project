"use client";

import { useEffect, useState } from "react";

/** "coarse" on touch screens, "fine" with a mouse. Null until mounted so server and first paint agree. */
export function usePointerKind(): "coarse" | "fine" | null {
  const [kind, setKind] = useState<"coarse" | "fine" | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setKind(media.matches ? "coarse" : "fine");
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return kind;
}
