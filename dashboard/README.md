# Sauti Desk (admin dashboard)

Next.js app for reviewing missed-call leads and editing business receptionist knowledge.

## Multi-tenant onboarding (Phase A)

1. Apply SQL in the Supabase SQL editor:  
   `docs/supabase/multi_tenant_onboarding.sql`  
   (creates `tenant_members`, default prompt helper, Auth → tenant trigger)
2. In Supabase Auth settings, enable **Email** provider. For local demos you can disable “Confirm email”.
3. Set dashboard env vars (anon + service role).
4. Open `/signup` to create a workspace (email, password, business name, notification phone).

The Auth trigger provisions a `tenants` row + `tenant_members` mapping. The signup Server Action also calls a service-role fallback if the trigger has not been applied yet.

## Local

```bash
cd dashboard
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Open http://localhost:3000 (or the port Next prints).

## Env

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser + server Auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key for Auth sessions |
| `SUPABASE_URL` | Same URL (server admin client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only reads/writes + tenant fallback |
| `DASHBOARD_PASSWORD` | Optional legacy shared-password desk |
| `DASHBOARD_OPEN=true` | Dev only: skip login if no password |

## Deploy (Vercel)

1. Import this repo in Vercel
2. Set **Root Directory** to `dashboard`
3. Add the env vars above (including `NEXT_PUBLIC_*`)
4. Deploy

Voice stays on Railway; this desk talks to Supabase Auth + DB.
