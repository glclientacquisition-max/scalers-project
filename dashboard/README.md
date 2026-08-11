# Scalers (owner desk + Super Admin)

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

### Strict view separation (owner vs Super Admin)

Two completely separate shells — roles never share navigation:

| Role | Layout | Nav | Landing after login |
|---|---|---|---|
| Workspace owner (Auth session) | `src/app/(desk)/layout.tsx` header | Calls, Business Settings, Sign out | `/calls` |
| Super Admin (legacy cookie) | `src/app/admin/layout.tsx` sidebar | Overview, Businesses, Numbers, Sign out | `/admin` |

Legacy-cookie sessions visiting `/calls` or `/settings` are redirected to `/admin`;
Auth owners visiting `/admin/*` are redirected to `/calls`.

### Sprint 2 — Onboarding wizard

New owners with a blank/default `llm_system_prompt` are redirected to `/onboarding`
(services & pricing → hours & location → tone). A server action compiles the answers
with Gemini (`GEMINI_API_KEY`) into `tenants.llm_system_prompt`, then opens `/calls`.
Without a Gemini key, a local template is saved instead.

### Owner command center (first open)

Owners land on **`/home`** (main dashboard). **`/calls`** remains the full triage inbox.

**Home dashboard**
1. **Glance cards** (interactive) — Waiting · Followed Up · Today · Balance
2. **Next action** — train / test / triage / caught up
3. **Line & tools** — DID, Done count, Archived count, quick links
4. **Lead triage** — top New leads with WhatsApp, Done, Archive, Open

**Inbox (`/calls`)**
- Search + filters: All · New · Followed Up · Done · Archived
- Bare `/calls` defaults to New when work is waiting
- All hides Archived (recover under Archived filter)

**Owner affordances (Auth + RLS safe)**

| Action | Behavior |
| --- | --- |
| Back | Detail → inbox preserves `?from=` filter |
| Open | Call detail titled by lead name (or number) |
| WhatsApp | Prefills a short follow-up using name + reason |
| Status | New → Followed Up → Done |
| Done | Soft finish = `resolved` |
| Archive | Soft hide = `archived` (apply `docs/supabase/lead_status_archive.sql`) |
| Search | Name / number / reason (`summary`) |

Hard delete, ledger writes, DID assignment, and prompt compile semantics stay Platform / Ops / Brain.



### AI Prompt Compiler (settings)

1. Apply `docs/supabase/tenant_business_profile.sql` (adds `business_hours`, `services_offered`, `agent_tone`).
2. Apply `docs/supabase/knowledge_acquisition_phase1.sql` (adds `agent_name`, `team_directory`, `faqs`).
3. Apply `docs/supabase/hours_schedule.sql` (adds `hours_schedule` for live open/closed).
4. Apply `docs/supabase/after_hours_mode.sql` (`serve` vs `message` when closed).
5. Apply `docs/supabase/services_catalog.sql` (structured services table).
6. Apply `docs/supabase/daily_bulletin.sql` (Today's updates / temporary overrides).
7. `/settings` edits structured fields (persona, weekly hours, services, FAQs, team) plus immediate Today's updates.
8. `saveAndCompileSettings` saves the fields, asks Gemini to write `llm_system_prompt`, and stores the result for the voice engine.
9. Voice injects a live CONTEXT HEADER (including daily bulletin) plus LIVE GROUND TRUTH on every call.

### Employee Training center (settings)

1. Apply `docs/supabase/employee_training.sql` (adds `tenants.unknown_answer_fallback`).
2. Owners write the exact line for requests outside their knowledge ("I don't know" fallback);
   the compiler bakes it into the receptionist prompt.
3. Save button shows "Training your receptionist…"; a Test Drive card shows the DID to call
   (tap-to-dial) once assigned.

### Wallet & billing (one KES prepaid wallet + beta)

1. Apply `docs/supabase/wallet_metering.sql`, `one_wallet_billing.sql`, then `wallet_security_beta.sql`.
2. Beta whitelist: `billing_enforcement = off` (default) — meter only, no charges. See `docs/BETA_WALLET_PROGRAM.md`.
3. Owners open **Wallet** for balance / usage (beta badge when free).
4. Voice engine charges only when enforcement is `soft`/`hard`.
5. Super Admin → **Wallets**: credit, plan toggle (beta ↔ prepaid), ledger. M-Pesa next.

### Phase C — DID pool

1. Apply `docs/supabase/did_number_pool.sql` in Supabase.
2. Point spare SautiKit DIDs’ webhooks at Railway.
3. Apply `docs/supabase/super_admin_ops.sql` (release/remove business helpers + optional Jirani teardown).
4. Login as ops (`admin@scalers.local` + `DASHBOARD_PASSWORD`) → **Admin**.
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
| `GEMINI_MODEL` | Optional: defaults to `gemini-3.5-flash-lite` (desk compile; 12s timeout then local fallback) |
| `SAUTIKIT_API_KEY` | Optional: Super Admin telecom panel + “Sync from SautiKit” (server-only) |
| `SAUTIKIT_ADMIN_OPS_KEY` | Optional Key B: Buy number (`numbers.claim`) — Vercel only |
| `VOICE_PUBLIC_BASE_URL` | Optional: Railway voice base for webhook routing after buy |
| `SAUTIKIT_API_BASE` | Optional: defaults to `https://api.sautikit.com` |
| `DASHBOARD_PASSWORD` | Optional legacy shared-password desk |
| `DASHBOARD_OPEN=true` | Dev only: skip login if no password |

## Deploy (Vercel)

1. Import this repo in Vercel
2. Set **Root Directory** to `dashboard`
3. Add the env vars above (including `NEXT_PUBLIC_*`)
4. Deploy

Voice stays on Railway; this desk talks to Supabase Auth + DB.
