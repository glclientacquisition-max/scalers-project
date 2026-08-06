# Sauti Desk (Phase 6 admin dashboard)

Next.js app for reviewing missed-call leads and editing business receptionist knowledge.

## Local

```bash
cd dashboard
cp .env.example .env.local
# fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_PASSWORD
npm install
npm run dev
```

Open http://localhost:3001 (or the port Next prints).

## Env

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only reads/writes |
| `DASHBOARD_PASSWORD` | Login password |
| `DASHBOARD_SECRET` | Optional cookie signing secret |
| `DASHBOARD_OPEN=true` | Dev only: skip login if no password |

## Deploy (Vercel)

1. Import this repo in Vercel
2. Set **Root Directory** to `dashboard`
3. Add the env vars above
4. Deploy

Voice stays on Railway; this desk only talks to Supabase.
