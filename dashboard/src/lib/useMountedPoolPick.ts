"use client";

import { useEffect, useState } from "react";
import { pickFromPool } from "@/lib/deskPlaceholders";

/**
 * First paint uses the first example so server and client HTML match.
 * After mount, one pool member is chosen.
 */
export function useMountedPoolPick(pool: readonly string[]): string {
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    setPicked(pickFromPool(pool));
  }, [pool]);

  if (picked && pool.includes(picked)) return picked;
  return pool[0] ?? "";
}
