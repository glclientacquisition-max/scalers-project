"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Esc returns to Inbox. Ignores fields and dialogs. */
export function InboxEscClose({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("input, textarea, select, [role='dialog']")) return;
      event.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, router]);

  return null;
}
