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

`createHttpDemoAdapter` posts the token, then opens `ws_url` with `&codec=pcm16`. Opus is not the default. The mic is resampled in an AudioWorklet to 16 kHz little-endian pcm16, 640 bytes every 20 ms. End sends `{type:'end'}`.

The server `session` message starts the countdown (`max_sec` 180, `recording` false). `state` drives Greeting, Listening, Thinking, and Speaking. A caption is shown and kept only in memory. Assistant audio plays gaplessly. `listening` stops playback at once. `end` uses its own line for `max_time`, `idle`, `user`, `cap`, `kill`, and `error`.

A failed upgrade uses status and `X-Demo-Reason` when the browser reports them: 404 `disabled` is paused, 400 `codec` is unsupported, 403 `origin` and 401 `rejected`, `expired`, `reused`, or `tenant` are the error state. The tenant id must be one of `…1101`, `…1102`, or `…1103`.

`createMockDemoAdapter` is for local preview and tests. Set `NEXT_PUBLIC_DEMO_ADAPTER=mock` to use it. Do not set that on a public deploy.

Preview every state at `/dev/voice-demo?state=` when `DASHBOARD_OPEN=true`. Add `&end=max_time` for an ended line. States: idle, consent, mic_denied, connecting, live, ended, disabled, busy, limit, error, unsupported.
