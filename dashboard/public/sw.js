/* Scalers Desk service worker. Hand-written, no build step. Runbook: docs/reference/platform/DESK_PWA_PUSH.md
 *
 * What it does:
 *  - Precaches only /offline and /offline/offline.css (a few KB; budget 150 KB).
 *  - Page loads (navigations): network first; on network failure show the cached /offline page.
 *    Successful pages are NEVER written to the cache, so no signed-in content is stored.
 *  - /api, /admin, /pay and every non-navigation request: not handled here (browser default, no cache).
 *  - push + notificationclick: shows the alert; a tap opens payload.url; payload.tag collapses repeats.
 *
 * Kill switch: set SW_KILL = true below and deploy. On its next update check (every navigation,
 * since /sw.js is served no-cache) each device deletes every scalers-* cache, unregisters, and
 * reloads its open tabs onto the network. Bump SW_VERSION on any other change.
 */
const SW_VERSION = "2026-10-25.1";
const SW_KILL = false;
const CACHE = `scalers-shell-${SW_VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/offline/offline.css"];
const NEVER = [/^\/api(\/|$)/, /^\/admin(\/|$)/, /^\/pay(\/|$)/];

self.addEventListener("install", (event) => {
  if (SW_KILL) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload", credentials: "omit" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("scalers-") && (SW_KILL || k !== CACHE)).map((k) => caches.delete(k))
      );
      if (SW_KILL) {
        await self.registration.unregister();
        const tabs = await self.clients.matchAll({ type: "window" });
        tabs.forEach((tab) => tab.navigate(tab.url));
        return;
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (SW_KILL) return;
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE });
      return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    })
  );
});

function safeUrl(raw) {
  try {
    const u = new URL(raw || "/home", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/home";
  } catch {
    return "/home";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Scalers";
  // iOS revokes subscriptions that receive a push without a visible notification: always show one.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: safeUrl(data.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/home";
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const tab of tabs) {
        if (new URL(tab.url).origin === self.location.origin && "focus" in tab) {
          await tab.focus();
          if ("navigate" in tab) await tab.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
