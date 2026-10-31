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
| 429 | `used` | Either the hashed IP or the hashed device id is already marked and has no grant left. Body is `{reason: used}` |
| 429 | `rate` | This hashed IP already has a demo session in progress, and this visitor still has a session or a grant left |
| 503 | `busy` | Live reservations are at `DEMO_MAX_CONCURRENT` (default 5). Body includes "All demo lines are busy, try again in a minute." |
| 503 | `disabled` | Flag off, or token secret, IP salt, or Turnstile secret missing. Body message is "Demo paused." |
| 503 | `cap` | Today's demo spend is at `DEMO_DAILY_CAP_USD` (default 2) or this month is at `DEMO_MONTHLY_CAP_USD` (default 50). Body is `{reason: cap}` |

The token is HS256, 60 seconds, single-use (`jti`). Claims are only `tenant` (`demo_home`, `demo_shop`, or `demo_other`), `lang`, `ip_hash`, `device_id`, `iat`, `exp`, `jti`. There is no dial claim.

Logs are `demo_token_ok` and `demo_token_reject` with a `reason`. They include the hashed IP, a hash of the device id, origin, Turnstile result, tenant, `consent_ts`, and `notice_v`. They do not include the raw IP, the raw device id, the token, the Turnstile secret, or audio.

A visitor is two salted SHA-256 hashes. The salt is `DEMO_IP_SALT`. The raw IP is not stored, and neither is the raw device id.

- IP: `sha256(DEMO_IP_SALT + "|ip|" + client IP)`. The client IP is the last `X-Forwarded-For` hop, otherwise the socket address.
- Device: `sha256(DEMO_IP_SALT + "|device|" + device_id)`.

`device_id` is made in the browser, once per profile. The widget reads `localStorage["scalers-demo-device"]`. If that value is missing or is not 8 to 128 characters from `A-Za-z0-9_-`, the widget sets it to `crypto.randomUUID()` (36 characters, hyphens kept) and writes that key. The same string is sent on every `POST /demo/token`. The server does not mint it.

The visitor is used if either hash has a row in `demo_visitor_use` with `grants_remaining` at 0. A blank, missing, or non-integer `DEMO_SESSIONS_PER_VISITOR` means 1. Integers 1 through 100 are kept. The first session inserts both rows. With the default of 1, `grants_remaining` starts at 0, so a second attempt is `used` even while the first session is still open. There is no daily reset and no TTL. `DEMO_VISITOR_WINDOW_HOURS` is not read. `rate` applies when this hashed IP already has a session open and the visitor still has a session or a grant left. The `used` response is 429 and the body is only `{reason: used}`.

`DEMO_VISITOR_PERSIST` must be exactly `on` to load and save `docs/supabase/demo_visitor_use.sql`. Voice does not apply that file. Any other value, including unset, keeps the markers in memory on this process. A restart, a redeploy, or a second instance drops those in-memory markers. When the flag is `on` and the table cannot be read, this process starts empty and logs `demo_visitor_load`.

The only intended way to allow another session is `POST /demo/grant`. One grant adds 1 to `grants_remaining` on that one hash. The next allowed session consumes one grant on each hash it touches. A grant on the IP hash does not clear a device hash that is still at 0, and the reverse is the same. An operator who wants one more demo grants each hash that is already marked. The logged `ip_hash` and `device_hash` are those visitor hashes.

These still start a visitor over, because the old hashes no longer match or the marker is gone: a new IP together with a new device id (cleared site data, a private window, or another browser, including a VPN plus cleared storage), a change of `DEMO_IP_SALT`, deleting the `demo_visitor_use` row, or `DEMO_VISITOR_PERSIST` left off across a restart. A new IP alone does not reset a marked device. A new device alone does not reset a marked IP. The one-at-a-time slot releases when the token expires or the socket closes. That does not clear `used`.

The one-at-a-time counter and the concurrency counter are in memory on one instance. A second instance does not share them. The used marker is shared only when `DEMO_VISITOR_PERSIST` is exactly `on` and the table is readable.

## `GET /demo/status`

No token and no Turnstile. The widget reads this before it asks for the microphone.

Success: `200 {enabled, busy, cap, reason}`.

| Field | Meaning |
| --- | --- |
| `enabled` | `DEMO_ENABLED` is exactly `on` |
| `busy` | Live reservations are at `DEMO_MAX_CONCURRENT` |
| `cap` | The daily or monthly spend cap is reached |
| `reason` | `null`, or the first of `disabled`, `cap`, `used`, `busy` |

`used` means this request's hashed IP is marked with no grant left, or the query `device_id` is present, matches the token charset, and that device hash is marked with no grant left. Without `device_id`, a mark that only the device would trip is not reported here. There are no minute counts, dollar amounts, session ids, hashes, or addresses in the body.

## `POST /demo/grant`

Not a public route. No Turnstile and no origin allowlist. The header `x-voice-internal-secret` must equal `VOICE_INTERNAL_SECRET`. A missing secret, or a header that does not match, is `401 {error: Unauthorized}`.

Body: `{visitor_hash, kind: ip|device, by}`. `visitor_hash` is the 64-character hex from the token log. `by` is the operator name, stored on `granted_by`. Each call adds 1 to `grants_remaining` and sets `granted_at`. Success is `200 {ok: true, grants_remaining}`. A bad hash or kind is `400 {reason: invalid}`. The response and the log do not include a raw IP or a raw device id.

A missing or disallowed `Origin` is `403 {reason: origin}`. More than 30 polls from one IP in a minute is `429 {reason: rate}`. The limiter is in memory on one instance and stores only a hash of the IP. A second instance does not share it.

## `wss://…/ws/demo?t=<token>`

Widget #1091 wires to this socket. The phone path is not this socket.

Query:

| Param | Values | Meaning |
| --- | --- | --- |
| `t` | the token from `POST /demo/token` | Required. Single use. Consumed when the upgrade is accepted |
| `codec` | `opus`, `pcm16`, `pcm8` | Wire format. Omitted: `opus` when `DEMO_OPUS` is exactly `on`, otherwise `pcm16` |

`DEMO_ENABLED` must be exactly `on` to start a session. There is no `Sec-WebSocket-Protocol`. `audio.drachtio.org` is not selected.

A missing or invalid token stays an HTTP failure. The body is JSON `{reason}` and the header `X-Demo-Reason` repeats it. Browsers do not expose that header on a failed handshake.

| Status | `reason` | When |
| --- | --- | --- |
| 404 | `disabled` | No token, and the flag is not exactly `on` |
| 403 | `origin` | `Origin` is missing or not in `DEMO_ALLOWED_ORIGINS`. The token is not consumed |
| 400 | `codec` | `codec=opus` while `DEMO_OPUS` is not exactly `on`, or the name is unknown. The token is not consumed |
| 401 | `rejected`, `expired`, `reused`, `tenant` | Token missing, bad, expired, already used, or not a demo tenant |

A token that verifies, when the session is then refused, completes the upgrade. The server sends `{type: end, reason}` and closes. `kill` means the flag is no longer exactly `on`. `cap` means the spend cap was already reached. Neither one starts speech.

An accepted token holds its concurrency slot until the socket closes, including a network drop. Closing the socket releases the slot. A second socket with the same token is `reused`. An unused token keeps the slot until the token expires.

### Client to server

Binary messages are mic audio. One message is one or more frames.

| `codec` | Frame | Bytes per 20 ms |
| --- | --- | --- |
| `opus` | Opus, 16 kHz, mono, 20 ms, VoIP. Requires `DEMO_OPUS=on` | one packet |
| `pcm16` | PCM16 little-endian, 16 kHz, mono | 640 |
| `pcm8` | PCM16 little-endian, 8 kHz, mono. The server upsamples to 16 kHz before speech-to-text | 320 |

Text messages are JSON.

| `type` | Fields | Meaning |
| --- | --- | --- |
| `end` | none | Visitor pressed End. The server closes with `reason: user` and stops processing |

Any other text is ignored. Text that is not JSON gets `{type: error, reason: protocol}`.

### Server to client

Text messages are JSON. Binary messages are assistant audio in the negotiated codec, with no phone gain. A binary frame follows an `assistant_audio` message for that utterance. Caller speech during assistant audio cancels that utterance. The server sends `{type: state, state: listening}` and does not send a telephony clear command.

| `type` | Fields | Meaning |
| --- | --- | --- |
| `session` | `session_id` (`demo_<uuid>`), `tenant` (`demo_home`, `demo_shop`, or `demo_other`), `tenant_id` (the uuid from the demo fixture), `lang` (`en` or `sw`), `codec`, `sample_rate` (16000), `frame_ms` (20), `max_sec` (180), `recording` (always `false`) | Socket is up. The greeting follows |
| `state` | `state`: `greeting`, `listening`, `thinking`, `speaking` | What the assistant is doing |
| `caption` | `role` (`caller` or `assistant`), `text`, `final` (boolean), `lang` | Live caption. Not written to the log or the database |
| `assistant_audio` | `codec`, `sample_rate`, `frame_ms`, `stream_id` | The next binary frames are this utterance |
| `error` | `reason` (`audio`, `protocol`, `brain`, `stt`, `tts`, `codec`, `tenant`), `message` | Something failed. The socket may stay up |
| `end` | `reason`: `max_time`, `idle`, `user`, `cap`, `kill`, `error` | Then the socket closes |

`max_time` is 180 seconds from connect, enforced by the server clock, not by the token `exp`. `idle` is 30 seconds without voiced caller audio. Both play a short goodbye in the session language (`Thank you. Goodbye.` or `Asante. Kwaheri.`) and then close. `user` is the End button and closes at once. `kill` is the flag leaving `on` while the socket is open. The server says the demo is paused, in English or Kiswahili, then closes. `error` is a startup failure. `cap` means the daily or monthly spend cap was reached. The server says the demo has reached its limit, in English or Kiswahili, then closes. A reconnect is a new token. There is no resume.

The session language starts as the token `lang` (`en` or `sw`). The greeting is that language's opener for `demo_home`, `demo_shop`, or `demo_other`. Tenant uuids match draft PR #1089: `11111111-1111-4111-8111-111111111101`, `…102`, `…103`. A stored profile is used only when its id is one of those and it is marked demo. There is no DID lookup.

Recording stays off. `DEMO_RECORD=on` does not store audio.

Logs are `demo_session_start` and `demo_session_end` with the session id, tenant, language, codec, hashed IP, hashed device, origin, duration, minutes, USD, and end reason. They do not include caption text, audio, the raw device id, or the token. `/healthz` `demo` is counts only.

### Codec gap

The spec's wire format is 16 kHz Opus. Chrome's WebCodecs Opus encoder often accepts only 48 kHz. This server decodes 16 kHz Opus packets only. If the browser cannot encode 16 kHz Opus, use `codec=pcm8` (the spec fallback, about 1.9 MB/min both ways) or `codec=pcm16` (16 kHz PCM, about 3.8 MB/min both ways). Opus at about 24 kbps is the path that meets the 0.5 MB/min note. The library is `opusscript` (pure JavaScript libopus, no native build).
