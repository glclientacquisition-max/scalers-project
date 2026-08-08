# Phase 5 — Production cutover

Move the voice engine off Cloudflare quick tunnels onto a persistent host, point SautiKit at it, and enable owner WhatsApp lead notify.

## 1. Merge stacked PRs

Merge in order on GitHub:

1. [#4](https://github.com/glclientacquisition-max/MISSED-CALL-PROJECT/pull/4) Supabase
2. [#5](https://github.com/glclientacquisition-max/MISSED-CALL-PROJECT/pull/5) SautiKit webhook + media
3. [#6](https://github.com/glclientacquisition-max/MISSED-CALL-PROJECT/pull/6) Full duplex agent
4. This Phase 5 PR (cutover)

## 2. Deploy the voice server

Pick one host (Railway recommended for long-lived WebSockets):

| Host | How |
| --- | --- |
| **Railway** | New project from this repo → uses `Dockerfile` + `railway.toml` → set env vars → deploy |
| **Render** | Blueprint `render.yaml` or Web Service, start `node server.js` |
| **DigitalOcean App Platform** | Dockerfile deploy, health check `/healthz` |

Required env vars (same as `.env.example`):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
SONIOX_API_KEY=
SONIOX_VOICE=
PUBLIC_BASE_URL=https://YOUR-PRODUCTION-HOST
```

Optional WhatsApp + webhook auth:

```
SAUTIKIT_API_KEY=
SAUTIKIT_WHATSAPP_NUMBER_ID=          # SautiKit number id (or CONNECTION_ID)
SAUTIKIT_WHATSAPP_TEMPLATE=           # Meta-approved template name (recommended)
SAUTIKIT_WHATSAPP_TEMPLATE_LANG=en
SAUTIKIT_WEBHOOK_SECRET=
SAUTIKIT_VALIDATE_WEBHOOKS=true
TENANT_ID=                           # pin single-tenant if DID lookup unused
```

After deploy, confirm:

```bash
curl -sS https://YOUR-PRODUCTION-HOST/healthz
# {"ok":true}
```

## 3. Point SautiKit at production

In the SautiKit console (or API), set the number / workspace **voice callback URL** to:

```
https://YOUR-PRODUCTION-HOST/
```

(or `/voice/incoming` — both work)

Also subscribe an **events** webhook to:

```
https://YOUR-PRODUCTION-HOST/voice/events
```

Subscribe at least: `call.completed`, `recording.ready`.

Safaricom / Airtel call-forwarding should already divert missed/busy/after-hours to the SautiKit DID.

## 4. Owner alerts (WhatsApp primary → email fallback)

**Primary (scale):** WhatsApp via SautiKit

1. Set `SAUTIKIT_API_KEY` + `SAUTIKIT_WHATSAPP_NUMBER_ID` (or `CONNECTION_ID`)
2. Optional template: `SAUTIKIT_WHATSAPP_TEMPLATE` / `_LANG`
3. Per business: owner alert WhatsApp number + Team Directory phones in Settings
4. Redeploy the voice server

**Fallback:** email via Resend (when WhatsApp is not ready or a send fails)

1. Set `RESEND_API_KEY` + `ALERT_EMAIL_FROM`
2. Optional env default: `OWNER_ALERT_EMAIL`
3. Per business: Alert email in Settings (`tenants.alert_email`)

Telegram is not used.

## 5. Cutover checklist

- [ ] Production `/healthz` returns ok
- [ ] Test call via production URL (greeting + STT + TTS)
- [ ] `call.completed` / `recording.ready` hit `/voice/events`
- [ ] Owner receives exactly one WhatsApp per completed lead
- [ ] Cloudflare quick tunnel removed from SautiKit callback
- [ ] Twilio ConversationRelay path unused (legacy `/ws/relay` only)

## 6. Rollback

Point the SautiKit voice callback back to the previous tunnel/host URL. Keep the previous Railway/Render deployment intact until the new one is verified.
