# Deployment

**Status:** Governance baseline (2026-08-14)

Scalers deploys as **two independent applications** plus **managed Supabase**.

---

## Deploy units

| Unit | Technology | Platform | Entry |
| --- | --- | --- | --- |
| Voice engine | Node.js 22, Express, WebSocket | Railway (primary), Render (alt) | `server.js` |
| Owner desk + Admin | Next.js 16 | Vercel | `dashboard/` |
| Database + Auth + Storage | Supabase | Supabase Cloud | External |

**FACT:** Not a monorepo deploy — voice and desk release independently.

---

## Voice engine (Railway)

### Configuration files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Node 22 slim; `npm ci --omit=dev`; copies `server.js`, `src/`, `scripts/`, `docs/` |
| `railway.toml` | Docker builder, health `/healthz`, restart on failure |
| `render.yaml` | Alternative: `node server.js`, same health path |

### Build and start

```dockerfile
CMD ["node", "server.js"]
EXPOSE 3000
HEALTHCHECK → GET /healthz
```

### Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Health check

```bash
curl -sS https://YOUR-VOICE-HOST/healthz
# {"ok":true,"soniox":{...}}
```

### SautiKit configuration (external)

Point number webhooks to:

- Voice callback: `https://YOUR-VOICE-HOST/` or `/voice/incoming`
- Events: `https://YOUR-VOICE-HOST/voice/events`

Subscribe: `call.completed`, `recording.ready` (minimum).

See: `docs/PRODUCTION_CUTOVER.md`, `docs/WEBHOOK_TUNNEL.md` (local).

---

## Dashboard (Vercel)

### Configuration

| File | Purpose |
| --- | --- |
| `dashboard/vercel.json` | `"framework": "nextjs"` |
| `dashboard/next.config.ts` | Turbopack root, output tracing |

### Vercel project settings

1. Import repository
2. **Root Directory:** `dashboard`
3. Set env vars (see `dashboard/.env.example`)
4. Deploy

### Build command

`npm run build` (Next.js 16)

### Desk → voice integration

Desk calls voice for:

- `GET /api/voices` (curated list — also available on voice directly)
- `POST /api/tts/preview` (phone preview in settings)

Requires `VOICE_PUBLIC_BASE_URL` and matching `VOICE_INTERNAL_SECRET`.

---

## Supabase

Not deployed from this repo. Schema applied manually:

1. Follow `docs/supabase/README.md` apply order
2. Enable Auth email provider
3. Configure RLS (owner policies)
4. Create `call-recordings` storage bucket

Voice uses **service role**. Owners use **anon + JWT**.

---

## Deployment checklist (production promote)

### Voice

- [ ] Env vars set on Railway/Render
- [ ] `/healthz` returns ok
- [ ] SautiKit webhooks updated
- [ ] `npm run test:voice` passed on releasing commit
- [ ] Test call on known DID

### Desk

- [ ] Vercel env vars set (`NEXT_PUBLIC_*` + service role)
- [ ] `VOICE_PUBLIC_BASE_URL` points at live voice host
- [ ] `npm run build` passed
- [ ] Login + settings save smoke test

### Database (if schema release)

- [ ] New SQL scripts applied in order on production project
- [ ] Applied scripts recorded in runbook

---

## Rollback

| Unit | Method |
| --- | --- |
| Voice | Railway: redeploy previous deployment |
| Desk | Vercel: instant rollback |
| Database | Forward-fix migration only — no destructive rollback without Platform approval |
| Git | `git revert` on `main` |

---

## Local vs production differences

| Concern | Local | Production |
| --- | --- | --- |
| Webhook URL | Tunnel (localtunnel/cloudflared) | Railway HTTPS |
| TTS preview auth | Secret optional in non-prod | `VOICE_INTERNAL_SECRET` required |
| Desk auth | `DASHBOARD_OPEN` possible | Supabase Auth + optional legacy admin password |
| Logging | Verbose HTTP header logs | Same code path — review TD-P1-4 |

---

## Related documents

- [`ENVIRONMENTS.md`](./ENVIRONMENTS.md)
- [`../governance/RELEASE_PROCESS.md`](../governance/RELEASE_PROCESS.md)
- [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md)
- [`../PRODUCTION_CUTOVER.md`](../PRODUCTION_CUTOVER.md)
