---
owner: desk
last_reviewed: 2026-10-31
---

# Landing voice demo widget

The landing section "Talk to the assistant" lets a visitor pick Home services, Shop, or Other business, read the notice in English or Kiswahili, allow the mic, and ask `POST /demo/token` for a session.

Nothing is sent until Start demo. The click is the consent action. `consent_ts` and notice version `2026-10-31` go with that request. End stops the mic. The widget does not record.

## Token

The voice service owns the endpoint (Voice PR1). This widget only calls it.

- Success: `200 {token, ws_url, max_sec}`.
- `503 {reason:'disabled'}` shows "Demo paused." The service does that unless `DEMO_ENABLED` is the exact value `on`.
- Origin is checked, then the Turnstile token, then the limits: 3 sessions a day per IP and per device, 1 at a time per IP, and 5 at once.
- `503 {reason:'busy'}` (and `cap`) shows "All demo lines are busy, try again in a minute."
- `429 {reason:'limit_daily'|'rate'}` is its own state: "You've used today's demos."
- The token itself is HS256, 60 seconds, single use. The widget does not mint it.

The site key is `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. It is public. The secret stays on the voice service.

## Session

`/ws/demo` arrives with Voice PR2. `DemoSessionAdapter` is the seam. `createHttpDemoAdapter` posts the token and then only runs the local 3:00 countdown. It does not open a socket and does not send audio. `createMockDemoAdapter` is for local preview and tests. Set `NEXT_PUBLIC_DEMO_ADAPTER=mock` to use it. Do not set that on a public deploy.

Preview every state at `/dev/voice-demo?state=` when `DASHBOARD_OPEN=true`. States: idle, consent, mic_denied, connecting, live, ended, disabled, busy, limit, error, unsupported.
