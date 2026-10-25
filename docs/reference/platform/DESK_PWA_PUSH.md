---
owner: platform
last_reviewed: 2026-10-25
---

# Installable Desk and phone alerts (runbook)

Plan: `/workspace/scalers/plans/2026-10-25-desk-pwa-push.md` (Alvin GO 25 Oct 10:13 EAT, staging build).
Desk lane: app shell, `/api/push/subscribe`, SQL file, Settings card, install card, `src/notifications/push.js`.
Voice/Brain lane: the `dispatchAlert` hook (spec below). Nothing here is wired into dispatch yet.

## Pieces

| Piece | File |
|---|---|
| Manifest (`/manifest.webmanifest`) | `dashboard/src/app/manifest.ts` |
| Icons (any + maskable 192/512, apple 180) | `dashboard/public/icons/*`, generator `dashboard/scripts/gen-pwa-icons.mjs` |
| Service worker | `dashboard/public/sw.js` (hand-written) |
| Registration (prod, app host, not admin) | `dashboard/src/components/ServiceWorkerRegister.tsx`, rules in `dashboard/src/lib/pwa.ts` |
| `/sw.js` headers (`Cache-Control: no-cache`, `Service-Worker-Allowed: /`) | `dashboard/next.config.ts` |
| Offline page | `dashboard/src/app/offline/page.tsx` + `dashboard/public/offline/offline.css` |
| Subscribe API (GET list, POST upsert by endpoint, DELETE by endpoint or id) | `dashboard/src/app/api/push/subscribe/route.ts` |
| Table + RLS (file only, not applied) | `docs/supabase/push_subscriptions.sql`, down `push_subscriptions_down.sql` |
| Send helper | `src/notifications/push.js` (`isPushConfigured`, `sendPush`) |
| Settings › How we notify › Phone alerts | `dashboard/src/components/PhoneAlertsCard.tsx` |
| Install card (desk shell only) | `dashboard/src/components/InstallCard.tsx` |
| Dev harness (DASHBOARD_OPEN=true) | `/dev/pwa?view=install-android|install-ios|alerts-off|alerts-on|alerts-denied|alerts-unconfigured|alerts-ios-needs-install` |
| Tests | `tests/deskPwaPush.test.js` (in `npm run test:mvp`) |

## Env (names only)

- Voice server: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or `https:`).
- Dashboard: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same public key). Unset → the card says alerts aren't ready; no fake controls.
- Generate with `npx web-push generate-vapid-keys`. Separate pairs for staging and prod. Leaked private key → rotate; every device must turn alerts on again.

## Service worker rules

- Precache: `/offline` (~18 KB HTML) and `/offline/offline.css` (~1 KB). Budget 150 KB.
- Navigations: network first, `/offline` on network failure. Pages are never written to cache, so no signed-in content is stored.
- `/api`, `/admin`, `/pay` and all non-navigation requests: not intercepted.
- Versioned cache `scalers-shell-<SW_VERSION>`; old `scalers-*` caches deleted on activate.
- **Kill switch:** set `SW_KILL = true` in `public/sw.js`, deploy. Because `/sw.js` is `no-cache`, each device picks it up on its next page load, deletes all `scalers-*` caches, unregisters and reloads open tabs from the network. Leave the kill build deployed for at least 2 weeks before removing `sw.js`.
- Push: always shows a notification (iOS revokes silent pushes). `tag` collapses repeats; tap opens `payload.url` (same-origin path only, else `/home`).
- Verified locally (next start, Chromium): SW registers with scope `/`, cache holds exactly the two files, offline `/settings` shows the offline page, `/api/*` offline is a network error (not served from cache).

## Phone alerts card

- "Turn on phone alerts" calls `Notification.requestPermission()` only on tap.
- Shows this device's status and lists the user's devices with Remove.
- Denied → help line (browser Site settings → Notifications). iOS not installed → 3 steps to add to Home Screen first.
- Sign-out (`SignOutButton`) removes this device's row and browser subscription first (max 1.5 s wait), then signs out.

## Install card

Bottom card "Weka Scalers kwenye simu yako / Add Scalers to your phone", Install + Not now (≥44 px). Not now hides it 30 days (`localStorage scalers-install-snooze`). Shown only after a call is in the Inbox (needs count > 0 or an Inbox row seen) or on the second visit. Desk shell only, so never on admin. Android uses the saved `beforeinstallprompt`; iOS shows 3 steps with inline SVG glyphs.

## Settled questions (25 Oct 2026)

- **9a Booking alerts path.** Not a separate path. `server.js` `maybeSendAppointmentNotification` → `dispatchToStaff` (`src/notifications/recipients.js`) → `dispatchAlert`, with `ledger.kind: 'appointment'`. When `OWNER_SUMMARY_SUPPRESS_LEGACY` is on, that per-booking send is skipped and the end-of-call owner summary (`src/notifications/ownerCallSummary.js`) carries the booking, also through `dispatchAlert`. Missed calls / leads (`kind: 'lead'`) and service requests (`'service_request'`) use the same function. So one hook in `dispatchAlert` covers all owner alerts.
- **9b Proxy.** `proxy.ts` runs on `/sw.js`, `/manifest.webmanifest`, `/offline*`, `/icons/*` (matcher skips only `_next/static|_next/image`). App host: no redirect, falls through. Admin host: `isAdminHostAllowedPath` is false, so they redirect to the app host (admin is not installable). Previews (unsplit hosts): untouched. Covered by `tests/deskPwaPush.test.js`.
- **9c CSP.** None. No `Content-Security-Policy` in `next.config.ts`, `vercel.json` or `proxy.ts` (test guards it), and the local `next start` response has no CSP header. Supabase does not set headers on our pages. If a CSP is added later it needs `worker-src 'self'`.
- **9d Maskable padding.** Yes. `icon.svg` is a blue mark on transparent with ~6% margin, so on a #0096FF square it would vanish and its corners would be clipped. The generator re-colours it white and scales it: maskable at 0.62 (farthest corner 30% of the side from centre, inside the 40% safe radius), any/apple at 0.8.

## Hook spec for Voice/Brain (not in this PR)

- **Where:** `src/notifications/dispatch.js`, inside `dispatchAlert`, after the channel loop has started (do not await before SMS/WhatsApp). Fire-and-forget, best effort; never replaces or delays SMS/WhatsApp/email.
- **Call:** `const { isPushConfigured, sendPush } = require('./push');` then, when `isPushConfigured()` and `channels.push === true` and the per-event key allows it: `sendPush({ tenantId: ledger.tenantId, title, body, url, tag })`.
- **Per-event keys** in `tenants.notify_channels` (parse in `notifyChannels.js`): `push` (default **false**; the Desk will set it true when the first device subscribes), `push_missed` (default true; `ledger.kind` `lead` / owner summary of a missed call), `push_booking` (default true; `kind` `appointment` / summary with a booking). `service_request` follows `push_missed`.
- **Payload:** `title` ≤ 80 chars ("Missed call" / "New booking"), `body` = the same short text as SMS (`renderEventText(event)`), `url` = `/calls/<callId>` (or `/appointments/<id>` for bookings), `tag` = `call-<callId>` or `appt-<id>` so repeats collapse. Whole payload is kept ≤ 2 KB by `buildPayload`.
- **Dedup:** push once per alert per tenant, not per staff recipient (`dispatchToStaff` loops recipients; call `sendPush` with `tenantId` once at the top-level alert, or with `userId` per recipient if team routing is wanted later).
- **Outcome logging:** add `push: 'sent' | 'failed' | 'skipped'` to the outcome passed to `buildNotifyOutcome` / `db.markWhatsappSent`, and record `owner_notify_channels` with `push` when `result.sent > 0`. Map `sendPush` result: `sent>0` → `sent`; `skipped` set → `skipped:<reason>`; else `failed`. Never mark the alert failed because push failed.
- **Env on Railway:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (staging first). Dependency `web-push` is already in the root `package.json`.

## Go-live order (each step needs Alvin's own GO)

1. Apply `docs/supabase/push_subscriptions.sql` on staging. 2. Set VAPID env on staging (dashboard + voice). 3. Merge this PR to staging and restage. 4. Voice/Brain hook. 5. Real-phone test: Android Chrome tab + installed, iPhone installed. 6. Prod.

Rollback: revert the PR; deploy `SW_KILL = true` if a worker is already on devices; `push_subscriptions_down.sql` drops saved devices.
