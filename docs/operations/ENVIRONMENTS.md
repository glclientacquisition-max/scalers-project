# Environments

**Status:** Governance baseline (2026-08-14)  
**Secrets:** Variable **names** only — never values.

---

## Summary

| Environment | Voice | Desk | Database | Status |
| --- | --- | --- | --- | --- |
| **Development** | Local `npm start` + tunnel | Local `npm run dev` | Supabase project (dev) | **ACTIVE** |
| **Staging** | Staging deploy (optional) | Vercel preview | `sgcdncjxauhsbunobmob` (`scalers-staging`) | **ACTIVE** (Phase 3E) |
| **Production** | Railway (referenced) | Vercel (referenced) | ALCR `fjxcdccgyhnvnnlnovcl` | **ACTIVE** |

**Governance gap:** Staging is not defined in the repository. Do not assume a staging environment exists.

---

## Development

### Voice engine

```bash
cp .env.example .env
npm ci && npm start
```

| Concern | Setup |
| --- | --- |
| Public webhook URL | `npm run tunnel` or `npm run tunnel:cloudflared` — see `docs/WEBHOOK_TUNNEL.md` |
| SautiKit | Point test DID webhook at tunnel URL |
| Required env | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Optional | `GEMINI_API_KEY`, `SONIOX_API_KEY`, `SAUTIKIT_*` |

`PUBLIC_BASE_URL` optional — Stream URLs can use request `Host` header.

### Dashboard

```bash
cd dashboard
cp .env.example .env.local
npm ci && npm run dev
```

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Auth |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Owner RLS client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server admin (never browser) |
| `GEMINI_API_KEY` | Prompt compile (local fallback if unset) |
| `VOICE_PUBLIC_BASE_URL` | Desk → voice TTS preview |
| `VOICE_INTERNAL_SECRET` | Must match voice engine for preview auth |
| `DASHBOARD_OPEN=true` | Skip login when no password (dev only) |

### Development bypasses

- `VOICE_INTERNAL_SECRET` unset + `NODE_ENV !== 'production'` → TTS preview auth allowed (`server.js` `voicePreviewAuthorized`)
- `DASHBOARD_OPEN=true` → desk open without password

**Do not enable bypasses in production.**

---

## Staging

**Status:** Updated Phase 3F (2026-08-15)

Staging is defined. See [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md) for safety rules.

| Field | Value |
| --- | --- |
| Name | `scalers-staging` |
| Project ref | `sgcdncjxauhsbunobmob` |
| URL | `https://sgcdncjxauhsbunobmob.supabase.co` |
| Region | `eu-west-2` |
| Rebuilt from Git | YES (Phase 3E, manual SQL path) |
| Evidence | [`STAGING_REBUILD_EXECUTION_REPORT.md`](./STAGING_REBUILD_EXECUTION_REPORT.md) |

| Component | Staging target |
| --- | --- |
| Supabase | `sgcdncjxauhsbunobmob` (no production data) |
| Voice | `https://scalers-staging-staging.up.railway.app` (Railway env `staging`) |
| Desk | `https://scalers-staging.vercel.app` (Vercel project `scalers-staging`) |
| SautiKit | Test DID(s) pointing at staging voice URL |

Validate database changes on staging before production. Never use production credentials for staging tests.

**Promote to production:** [`STAGING_TO_PRODUCTION.md`](./STAGING_TO_PRODUCTION.md)

---

## Production

### Referenced URLs (not verified live in audit)

| Service | URL (from code/docs) |
| --- | --- |
| Voice | `https://scalers-project-production.up.railway.app` |
| Desk | `https://scalers-project.vercel.app` |

### Production env (names only)

**Voice** — see root `.env.example`:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `SONIOX_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`
- `SAUTIKIT_API_KEY`, `SAUTIKIT_WEBHOOK_SECRET`, `SAUTIKIT_VALIDATE_WEBHOOKS`
- `TEXTSMS_*`, `RESEND_*`, `ALERT_EMAIL_FROM`
- `WALLET_*`, `VOICE_*`, `PUBLIC_BASE_URL`, `VOICE_INTERNAL_SECRET`

**Desk** — see `dashboard/.env.example`:

- `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_*`, `SAUTIKIT_*`, `SAUTIKIT_ADMIN_OPS_KEY`
- `VOICE_PUBLIC_BASE_URL`, `VOICE_INTERNAL_SECRET`
- `DASHBOARD_PASSWORD` (legacy Super Admin)

### Cross-service secrets that must match

| Variable | Must match between |
| --- | --- |
| `VOICE_INTERNAL_SECRET` | Railway voice ↔ Vercel desk |
| `SUPABASE_URL` | Voice ↔ desk ↔ same project |
| `VOICE_PUBLIC_BASE_URL` | Desk → voice host for preview and DID routing |

---

## External integrations by environment

| Integration | Dev | Staging | Prod |
| --- | --- | --- | --- |
| SautiKit | Test keys / tunnel | Test/staging keys | Production keys |
| Soniox | API key | Staging key | API key |
| Gemini | API key | Staging key | API key |
| TextSMS | Optional | Staging/test | Production |
| Supabase | Dev or staging project | `sgcdncjxauhsbunobmob` | ALCR `fjxcdccgyhnvnnlnovcl` |

---

## Related documents

- [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- [`../governance/HISTORY_GAPS.md`](../governance/HISTORY_GAPS.md)
- [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md)
- [`RELEASE_GATE.md`](./RELEASE_GATE.md)
