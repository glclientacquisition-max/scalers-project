# Sauti Desk (admin dashboard)

Next.js app for reviewing missed-call leads and editing business receptionist knowledge.

## Multi-tenant onboarding (Phase A)

1. Apply SQL in the Supabase SQL editor:  
   `docs/supabase/multi_tenant_onboarding.sql`  
   (creates `tenant_members`, default prompt helper, Auth → tenant trigger)
2. Apply `docs/supabase/owner_rls.sql`  
   (RLS on tenants / calls / transcripts / tenant_members — owners isolated by membership)
3. Apply `docs/supabase/tenant_business_profile.sql`  
   (structured hours / services / tone for the AI Prompt Compiler)
4. Apply `docs/supabase/voice_languages.sql`  
   (automatic English / Kiswahili / Sheng — no user picker; locals later)
5. In Supabase Auth settings, enable **Email** provider. For local demos you can disable “Confirm email”.
6. Set dashboard env vars (anon + service role + optional `GEMINI_API_KEY`).
7. Open `/signup` to create a workspace (email, password, business name, notification phone).

The Auth trigger provisions a `tenants` row + `tenant_members` mapping. The signup Server Action also calls a service-role fallback if the trigger has not been applied yet.

### Sprint 1 — RLS & clients

| Surface | Client | Key |
|---|---|---|
| `/calls`, `/settings` (owner) | `@supabase/ssr` Auth session | Anon + JWT; RLS enforced |
| `/admin/*`, DID pool, signup provisioner | Service role (server-only) | `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) |
| Railway voice engine | Service role | Same — writes calls/transcripts |

Never put the service role key in `NEXT_PUBLIC_*` or browser bundles.

### Sprint 2 — Onboarding wizard

New owners with a blank/default `llm_system_prompt` are redirected to `/onboarding`
(services & pricing → hours & location → tone). A server action compiles the answers
with Gemini (`GEMINI_API_KEY`) into `tenants.llm_system_prompt`, then opens `/calls`.
Without a Gemini key, a local template is saved instead.

### AI Prompt Compiler (settings)

1. Apply `docs/supabase/tenant_business_profile.sql` (adds `business_hours`, `services_offered`, `agent_tone`).
2. `/settings` edits those structured fields only — no raw prompt textarea.
3. `saveAndCompileSettings` saves the fields, asks Gemini to write `llm_system_prompt`, and stores the result for the voice engine.

### Phase C — DID pool

1. Apply `docs/supabase/did_number_pool.sql` in Supabase.
2. Point spare SautiKit DIDs’ webhooks at Railway.
3. Apply `docs/supabase/super_admin_ops.sql` (release/remove business helpers + optional Jirani teardown).
4. Login as ops (`admin@sauti.local` + `DASHBOARD_PASSWORD`) → **Admin**.
5. Use **Numbers** to seed DIDs; **Businesses** to assign / release / remove.

See `docs/PRODUCTION_DID_POOL.md` and `docs/SUPER_ADMIN_REQUIREMENTS.md`.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only: Super Admin, DID pool, signup provisioner (never browser) |
| `GEMINI_API_KEY` | Optional: onboarding prompt compile (local template fallback if unset) |
| `GEMINI_MODEL` | Optional: defaults to `gemini-2.0-flash` |
| `DASHBOARD_PASSWORD` | Optional legacy shared-password desk |
| `DASHBOARD_OPEN=true` | Dev only: skip login if no password |

## Deploy (Vercel)

1. Import this repo in Vercel
2. Set **Root Directory** to `dashboard`
3. Add the env vars above (including `NEXT_PUBLIC_*`)
4. Deploy

Voice stays on Railway; this desk talks to Supabase Auth + DB.
