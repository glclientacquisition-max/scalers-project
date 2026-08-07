# Phase C — SautiKit DID number pool

## Goal

New Scalers signups get a real `+254…` DID from a pre-bought pool instead of staying on `pending:<user_id>`.

## One-time setup

1. **SQL** — In Supabase SQL Editor, run:
   `docs/supabase/did_number_pool.sql`  
   (safe after Phase A onboarding SQL)

2. **Buy / prepare DIDs in SautiKit** for each spare number:
   - Voice callback URL → `https://YOUR-RAILWAY-HOST/` (or `/voice/incoming`)
   - Events URL → `https://YOUR-RAILWAY-HOST/voice/events`
   - Same Stream / media settings as the smoke DID

3. **Seed the pool** (pick one):
   - Desk: login as `admin@scalers.local` + `DASHBOARD_PASSWORD` → **Admin → Numbers**  
   - Or SQL:

```sql
insert into public.sautikit_did_pool (e164, status, notes) values
  ('+2547XXXXXXXX', 'available', 'webhooks on Railway')
on conflict (e164) do nothing;
```

4. **Pending tenants** already signed up with `pending:…`:
   - Desk → DID pool → select tenant → **Assign next available**
   - Or: `select public.assign_did_from_pool('<tenant-uuid>');`

## Runtime behaviour

- Auth signup trigger + `ensureTenantForUser` call `assign_did_from_pool`.
- If the pool is empty, tenant keeps `pending:` until ops assigns one.
- Voice engine ignores `pending:` DIDs when matching inbound calls.

## Do not

- Put Jirani’s live DID in the pool as `available` (backfill already marks it `assigned`).
- Expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
