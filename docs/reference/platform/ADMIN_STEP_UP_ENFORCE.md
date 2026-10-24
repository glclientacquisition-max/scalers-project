---
owner: platform
last_reviewed: 2026-10-24
status: proposed
---

# Admin Unlock enforce (authenticator) — build and runbook

Design approved by Alvin on 24 Oct 2026. It narrows the broader spec in draft #876 (`ADMIN_STEP_UP.md`) to a self-contained build: no Better Auth plugin and no `admin_auth` schema.

## What it does

- **Authenticator (TOTP, RFC 6238):** SHA-1, 30 s, 6 digits, ±1 step. A step that was already accepted is refused (replay guard). Setup shows a QR code and the key to type in by hand. The secret is stored AES-256-GCM encrypted (`ADMIN_STEP_UP_KEY`).
- **Backup codes:** 10 single-use codes, shown once at setup and stored as SHA-256 hashes. Using one is logged and emailed, and the sheet then asks the operator to set up the authenticator again, which retires the old secret.
- **Unlock:** lasts 10 minutes. It is a row in `admin_step_up_grant` plus an httpOnly, `SameSite=Strict` cookie `scalers_admin_unlock` that holds only the grant id.
- **Lockout:** 5 wrong codes lock Unlock for that operator for 15 minutes.
- **Server gate:** `stepUpGate` / `stepUpGateSession` (`dashboard/src/lib/ops/stepUpGate.ts`) return `403 step_up_required` for risky writes without a live unlock. The list is in `stepUpCore.ts` `RISKY`: pool release/assign, business release/archive/transfer owner/assign, invoice void/credit note, number hold actions, package publish/move subscribers/billing mode, billing grant minutes/assign package/checkout review/billing mode, and platform settings save.
- **Audit (`ops_audit_log`):** `admin.step_up.verified`, `.failed`, `.locked`, `.blocked`, `admin.2fa.enrolled`, `admin.2fa.backup_code_used`, `admin.2fa.reset`.

## Flags and env

| Var | Value | Effect |
| --- | --- | --- |
| `ADMIN_STEP_UP_ENFORCE` | exactly `on` | Enforce. Anything else leaves today's observe/off behaviour |
| `ADMIN_STEP_UP_KEY` | random, at least 32 chars | Encrypts TOTP secrets and peppers backup-code hashes. **Do not rotate** without re-enrolling every operator |
| `ADMIN_STEP_UP_ALERT_EMAIL` | comma list | Security emails (backup code used, authenticator reset) through `sendOpsMail` (Resend). Unset means skipped and logged |

Set the key before turning enforce on. If the key is missing, unlock returns `500 step_up_misconfigured` and risky writes stay blocked (fails closed).

## Database

`docs/supabase/admin_step_up.sql` (down: `admin_step_up_down.sql`). Three tables, RLS on with no policies, service_role only, and `admin_step_up_reset(operator, actor, reason)` (security definer, execute for service_role only).

## Operator reset

Settings › Security is not built yet. Until it is, the API is `POST /api/admin/step-up/reset {target, reason}`. The caller needs their own live unlock and a reason of at least 3 characters, and cannot reset themselves (use a backup code). The DB function writes the audit row. The target sets up again at their next Unlock.

## Last-resort reset (only operator, phone and backup codes lost)

Only with Alvin's yes in chat. Confirm identity out of band first.

```sql
select public.admin_step_up_reset('<operator username>', 'platform:<who ran this>', '<why + who approved>');
```

Run it in the SQL editor of the right project, staging first if testing. It clears the secret and backup codes, revokes live unlocks, and writes `admin.2fa.reset`. The operator then opens any Unlock and sets up again. Add a dated line to `docs/STATUS.md`.

## Rollout

1. Apply SQL on staging. Set `ADMIN_STEP_UP_KEY` and `ADMIN_STEP_UP_ALERT_EMAIL` on Vercel Preview/staging, then `ADMIN_STEP_UP_ENFORCE=on`.
2. Alvin sets up with his phone, saves the backup codes, and test-unlocks a Release on a test business (never Done and Dusted).
3. Prod: only on Alvin's GO. Apply SQL, set the key, then the flag. Rollback: unset `ADMIN_STEP_UP_ENFORCE`.
