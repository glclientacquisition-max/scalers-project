"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/components/ui/DeskNotice";
import { PASSWORD_UPDATED_NOTICE } from "@/lib/passwordReset";

/**
 * One-time toasts from the URL, then cleans it: "Welcome to <business>" after an invite is accepted,
 * and a confirmation after a password reset.
 */
export function WelcomeToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const welcome = params.get("welcome");
  const passwordUpdated = params.get("notice") === PASSWORD_UPDATED_NOTICE;
  useEffect(() => {
    if (!welcome && !passwordUpdated) return;
    notify(welcome ? `Welcome to ${welcome.slice(0, 80)}.` : "Your new password is saved.");
    const next = new URLSearchParams(params);
    next.delete("welcome");
    next.delete("notice");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [welcome, passwordUpdated, params, pathname, router]);
  return null;
}
