---
owner: ops-billing
last_reviewed: 2026-10-14
---

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
   - Admin: `/admin/login` with username + access code → **Numbers** → Add to pool  
   - Or SQL:

```sql
insert into public.sautikit_did_pool (e164, status, notes) values
  ('+2547XXXXXXXX', 'available', 'webhooks on Railway')
on conflict (e164) do nothing;
```

4. **Businesses** already signed up with `pending:…`:
   - Numbers → Assign to a business → **Assign next available**, or pick a specific Available number
   - Or: `select public.assign_did_from_pool('<tenant-uuid>');`

## Release

**Numbers** and **Businesses** both ask before Release number. The number returns to Available.

- If a business still holds it, that business goes back to Waiting for a number.
- If the business row is already gone and the pool row is still Assigned, release from **Numbers** frees the row anyway. (History: `+254709221536` was freed this way after Jirani Home Services was removed. It is now **Aris Kenya's live prod DID**: see [`STATUS.md`](../STATUS.md) section 1. **Never release, reassign, or re-point it.**)

## Runtime behaviour

- Auth signup trigger + `ensureTenantForUser` call `assign_did_from_pool`.
- If the pool is empty, tenant keeps `pending:` until ops assigns one.
- Voice engine ignores `pending:` DIDs when matching inbound calls.

## Do not

- Seed a live DID as `available` while a business still holds it (backfill marks it `assigned`). After the business is gone, release it from Numbers.
- Release `+254709221536` (Aris, live paying customer). Releasing any prod DID needs Alvin's explicit yes.
- Expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Treat a new DID as the answer to a SautiKit outage. Restore or forward the existing number. See `docs/agents/VOICE_DOWNTIME_AT_SCALE.md#telephony-down-bridge-playbook`.
- Release a suspended-for-nonpayment DID straight to `available`. `suspend_line_for_nonpayment` marks it `disabled` so ops can decide.
