"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/components/ui/DeskNotice";

/** Shows "Welcome to <business>" once after an invite is accepted, then cleans the URL. */
export function WelcomeToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const welcome = params.get("welcome");
  useEffect(() => {
    if (!welcome) return;
    notify(`Welcome to ${welcome.slice(0, 80)}. You're on the team.`);
    const next = new URLSearchParams(params);
    next.delete("welcome");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [welcome, params, pathname, router]);
  return null;
}
