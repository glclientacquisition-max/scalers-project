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
- The body field is `device_id`. The widget reads `localStorage["scalers-demo-device"]`. A missing value, or one that is not 8 to 128 characters from `A-Za-z0-9_-`, is replaced with `crypto.randomUUID()` and saved. If storage throws, that id stays in memory for the page. Server render does not mint one.
- `503 {reason:'busy'}` shows "All demo lines are busy, try again in a minute."
- `503 {reason:'cap'}` shows "The demo is resting for today. Try again tomorrow."
- `429 {reason:'limit_daily'}` shows "You've used today's demos."
- `429 {reason:'used'}` replaces Start with the request-access form.
- `429 {reason:'rate'}` means a second session is already open and the visitor still has one left: "A demo is already open. Try again in a minute."
- The token itself is HS256, 60 seconds, single use. The widget does not mint it.

The site key is `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. It is public. The secret stays on the voice service.

## Session

Before Start, the page calls `GET /demo/status?device_id=`. The same id goes on `POST /demo/token`. The widget never calls `POST /demo/grant`. The reason order is disabled, then cap, then used, then busy. `disabled` shows "Demo paused." `cap` shows "The demo is resting for today. Try again tomorrow." `used` (from that status, or `429 {reason:'used'}` on the token) replaces Start with a request-access form. The submit is a local stub until the backend exists. Token `429 {reason:'rate'}` means a session is already open and the visitor still has one left: "A demo is already open. Try again in a minute." A `429 {reason:'rate'}` on the status poll is the poll limit and is ignored.

`createHttpDemoAdapter` posts the token, then opens `ws_url` with `codec=pcm8` on a touch or phone (8 kHz, 320 bytes every 20 ms, about 1 MB a minute) and `codec=pcm16` on a desktop (16 kHz, 640 bytes, about 4 MB a minute). Opus is not used. End sends `{type:'end'}`.

The server `session` message starts the countdown (`max_sec` 180, `recording` false). `state` drives Greeting, Listening, Thinking, and Speaking. A caption is shown and kept only in memory. Assistant audio plays gaplessly. `listening` stops playback at once. An accepted socket that then sends `{type:'end', reason:'kill'}` shows "Demo paused." `reason:'cap'` shows the resting line. The other end reasons keep their own lines.

If the WebSocket upgrade fails, the page calls `GET /demo/status` once and uses that state. Otherwise it shows the generic error. It does not guess from resource timing. The tenant id must be one of `…1101`, `…1102`, or `…1103`.

`createMockDemoAdapter` is for local preview and tests. Set `NEXT_PUBLIC_DEMO_ADAPTER=mock` to use it. Do not set that on a public deploy.

Preview every state at `/dev/voice-demo?state=` when `DASHBOARD_OPEN=true`. Add `&end=max_time` for an ended line. States: idle, consent, mic_denied, connecting, live, ended, disabled, busy, rate, cap, request, requested, limit, error, unsupported.
