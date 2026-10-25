"use client";

import { deviceLabelFrom, installPlatform, urlBase64ToUint8Array } from "@/lib/pwa";

/** Browser side of phone alerts. Nothing here asks for permission except subscribeThisDevice(). */

export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  // Settings may open before the root registrar ran (or in dev): register on demand.
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg || !("pushManager" in reg)) return null;
  return reg.pushManager.getSubscription();
}

/** Call only from a tap. Returns the resulting permission. */
export async function subscribeThisDevice(): Promise<NotificationPermission | "error"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await registration();
  if (!reg) return "error";
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));
  const ua = navigator.userAgent;
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      platform: installPlatform(ua, isStandalone()),
      device_label: deviceLabelFrom(ua),
    }),
  });
  return res.ok ? "granted" : "error";
}

/** Removes this device's alerts (server row + browser subscription). Safe when there is none. */
export async function unsubscribeThisDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      keepalive: true,
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  } catch {
    /* sign-out must never be blocked by this */
  }
}
