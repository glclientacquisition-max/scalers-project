"use client";

import { useEffect } from "react";
import { shouldRegisterServiceWorker } from "@/lib/pwa";

/** Registers /sw.js on the app host in production only. Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const ok = shouldRegisterServiceWorker(window.location.hostname, window.location.pathname, {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_ADMIN_HOST: process.env.NEXT_PUBLIC_ADMIN_HOST,
      NEXT_PUBLIC_APP_HOST: process.env.NEXT_PUBLIC_APP_HOST,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    });
    if (!ok) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* The Desk works without it. */
    });
  }, []);
  return null;
}
