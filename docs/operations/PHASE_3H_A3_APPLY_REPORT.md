# Phase 3H A3 apply report: notify_channels grant

**Date:** 2026-08-16  
**Status:** APPLIED on production ALCR  
**Human approval:** Operator (this session)  
**Production ALCR:** `fjxcdccgyhnvnnlnovcl`  
**SQL:** `docs/supabase/production_pending/grant_notify_channels_update.sql`

---

## What was applied

```sql
grant update (notify_channels) on public.tenants to authenticated;
```

| Record | Value |
| --- | --- |
| CLI version | `20260816180900` |
| CLI name | `grant_notify_channels_update` |
| Ledger | `LEDGER-PROD-NOTIFY-GRANT` |
| RLS | Unchanged (`tenants_update_member` only) |

Privilege was already `true` at session start (operator SQL Editor or equivalent). The CLI migration was recorded so production history matches Git.

---

## Verification (read-only after apply)

| Check | Production | Staging |
| --- | --- | --- |
| `has_column_privilege(authenticated, tenants.notify_channels, UPDATE)` | **true** | **true** |
| `has_column_privilege(authenticated, tenants.wallet_balance_kes, UPDATE)` | **false** | **false** |
| `tenants_update_member` policy | **present** | (unchanged) |

Wallet columns remain RPC-only. No storage policy SQL was applied.

---

## A4 remaining (operator desk smoke)

Production Desk: `https://scalers-project.vercel.app`

1. Sign in as an owner.
2. Settings, Notifications: change one channel toggle.
3. Save. Reload. Confirm the toggle persisted.
4. If save errors mention `notify_channels`, capture the message.

This report does **not** close A4. Owner JWT save was not executed in this session.

---

## Rollback

```sql
revoke update (notify_channels) on public.tenants from authenticated;
```

Do not drop the column.

---

## Next (Phase 3H sequence)

| Item | Status |
| --- | --- |
| A1 Staging GitHub secrets | **DONE** (`staging-validate` green on `main`) |
| A3 notify_channels grant | **DONE** (this report) |
| B1 Verbose log redaction | **DONE** (#165) |
| B3 Staging deploy URLs | **DONE** (`STAGING_TO_PRODUCTION.md`) |
| A4 Production desk notify save | **NEXT** (operator) |
| A2 / A5 Staging E2E + live call scores | **NEXT** (manual; needs test DID) |
| B2 Staging DID pool seed | Ops, when test numbers exist |
| Storage policy SQL | Do not apply until production storage audit |
