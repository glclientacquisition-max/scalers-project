---
owner: voice
last_reviewed: 2026-10-31
---

# Browser demo contract

Frozen for the token endpoint. The widget and `/ws/demo` follow this shape. The phone path is not part of it.

`DEMO_ENABLED` must be the exact value `on`. Anything else, including unset, means the demo is off.

## `POST /demo/token`

Request JSON: `{tenant: home|shop|other, lang: en|sw, turnstile, device_id, consent_ts, notice_v}`.

Success: `200 {token, ws_url, max_sec}`. `max_sec` is 180. `ws_url` is `wss://…/ws/demo?t=<token>`.

Errors:

| Status | `reason` | When |
| --- | --- | --- |
| 403 | `origin` | `Origin` is missing or not in `DEMO_ALLOWED_ORIGINS` |
| 403 | `turnstile` | Turnstile token missing or siteverify failed |
| 403 | `tenant` | Tenant is not home, shop, or other, or the request names Aris `+254709221536` |
| 429 | `rate` | This IP already has a demo session in progress |
| 429 | `limit_daily` | 4th session in the EAT day for this hashed IP or this device |
| 503 | `busy` | Live reservations are at `DEMO_MAX_CONCURRENT` (default 5). Body includes "All demo lines are busy, try again in a minute." |
| 503 | `disabled` | Flag off, or token secret, IP salt, or Turnstile secret missing. Body message is "Demo paused." |
| 503 | `cap` | Reserved for the daily minute cap. Not enforced on this endpoint yet |

The token is HS256, 60 seconds, single-use (`jti`). Claims are only `tenant` (`demo_home`, `demo_shop`, or `demo_other`), `lang`, `ip_hash`, `device_id`, `iat`, `exp`, `jti`. There is no dial claim.

Logs are `demo_token_ok` and `demo_token_reject` with a `reason`. They include the hashed IP, device, origin, Turnstile result, tenant, `consent_ts`, and `notice_v`. They do not include the raw IP, the token, the Turnstile secret, or audio.

The rate limiter and the concurrency counter are in memory on one instance. A second instance does not share them.

## `wss://…/ws/demo?t=<token>`

Not implemented on this change. Client audio and server audio, plus JSON `{type, reason}`, are specified for the later session work. End reasons: `max_time`, `idle`, `user`, `cap`, `kill`, `error`.
