---
owner: platform
last_reviewed: 2026-10-22
status: proposed
---

# Admin step-up verification and break-glass runbook

Spec for asking an operator for a code before a sensitive Admin action, even when signed in. Source: [`ADMIN_FOUNDATION_PLAN.md`](../operations/ADMIN_FOUNDATION_PLAN.md) §4. Nothing here is built or applied yet: no `admin_auth` schema exists on staging or prod (read-only check, 22 Oct 2026).

Status: **proposed**. Values marked *(Q n)* are decided by Alvin's answer to plan §9 question n (per Scalers Chief relaying Alvin, 22 Oct 16:36 EAT): 12 h sessions, 15-minute Tier A window up to KES 20,000, authenticator at sign-in after step 1, one operator (Alvin, owner, scalersventures@gmail.com), backup codes to scalersventures@gmail.com, same rules on staging.

## 1. Tiers

| Tier | Rule | Intents |
| --- | --- | --- |
| A | One code opens a 15-minute window for that session (fixed, not extended by activity) *(Q2, decided)* | `billing.grant_minutes`, `billing.package.assign`, `billing.checkout_review.resolve`, `pricing.rates.save`, `pricing.package.save`, `pricing.version.publish`, `numbers.pool.release`, `numbers.pool.assign`, `business.archive`, `business.transfer_owner`, `payments.record` (≤ KES 20,000), `ledger.adjust` |
| B | Fresh code per action, bound to it, single use, valid 5 minutes | `switch.billing_flag`, `switch.billing_mode`, `numbers.buy`, `numbers.provider_release`, `payments.record_large` (> KES 20,000), `security.factor_change`, `operators.change` |

Action digest: `sha256(intent | target id | amount | new value)`. The step-up sheet shows the same facts in words, with the environment in the title.

Not step-up: reads, search, voice catalogue edits, profile edits, pay-link creation, test email. Typed confirmation words stay and are additional.

## 2. Factors

| Factor | Role |
| --- | --- |
| Authenticator app (TOTP) | Primary, required. 6 digits, 30 s, ±1 step. Issuer differs on staging and prod |
| Email code | Backup only. 6 digits, 5 min, stored hashed, single use, max 3 sends per 15 min. Every use sends a security alert *(Q5: scalersventures@gmail.com)* |
| Backup codes | 10 single-use codes shown once |
| SMS | Not offered |

**Risk (one inbox):** scalersventures@gmail.com is both the owner operator email and the backup-code inbox. Whoever controls it can both sign in and receive backup codes, so that inbox must have its own strong 2FA (authenticator or passkey, not SMS).

## 3. Session and limits

| Item | Rule |
| --- | --- |
| Session | Row in `admin_auth.session`, revocable. 12 h hard cap, no sliding *(Q1, decided; today 14 days)* |
| Failures | 5 wrong codes in 15 min locks step-up for that operator for 15 min, audit row plus alert |
| TOTP replay | An accepted code is refused for 90 s |
| Not enrolled | `403 step_up_enrolment_required`, sheet links to Settings › Security |
| Legacy HMAC cookie or open-dashboard mode | `403 operator_session_required`. Fails closed in production |
| Factor endpoints | Enable, disable, backup codes and TOTP URI need a fresh `security.factor_change` grant. `trustDevice` is refused |
| Rollout | `ADMIN_STEP_UP`: `off` → `observe` (logs only) → `enforce`. Prod moves one stage at a time on Alvin's yes |

## 4. Request flow

1. The client calls the route through `adminFetch()`.
2. The route calls `requireStepUp(request, intent, facts)` right after the operator check. No grant: `403 step_up_required` with intent, tier and digest.
3. `adminFetch` opens **`StepUpSheet`**: bottom sheet below `md`, right drawer at `md`+. Never a centred modal (see [`OPS.md` §3](../design-system/OPS.md#3-overlays-locked-22-oct-2026)).
4. `POST /api/admin/step-up` verifies the code with the cookie cache bypassed, checks the lock, writes a grant and an `admin.step_up.verified` audit row.
5. `adminFetch` retries once. Tier B grants are consumed atomically. The action's audit row carries the grant id and method.

Audit actions in `public.ops_audit_log`: `admin.step_up.verified`, `.failed`, `.locked`, `.would_block`, `admin.2fa.enrolled`, `admin.2fa.reset`, `admin.session.revoked`.

## 5. Break-glass runbook

Use only when an operator has lost the phone, the backup codes and the backup inbox. **Only with Alvin's yes in chat.**

1. Confirm the operator's identity out of band (voice call to a known number).
2. Platform opens the SQL editor for the right project (staging first if testing).
3. Delete that operator's `admin_auth.two_factor` row only. Do not touch sessions of other operators.
4. Insert an `ops_audit_log` row by hand: action `admin.2fa.reset`, actor = the Platform operator, detail = who approved and why.
5. Revoke the operator's sessions (`delete from admin_auth.session where user_id = 'admin:<username>'`).
6. The operator signs in and re-enrols with an email code.
7. Add a dated line to `docs/STATUS.md`: change, approver, rollback (none; re-enrol).

## 6. Secret rotation runbook

Never rotate `BETTER_AUTH_SECRET` by replacing it: that makes every enrolled authenticator unreadable. Use the versioned list `BETTER_AUTH_SECRETS=2:<new>,1:<old>`, deploy, confirm sign-in and a step-up on staging, then drop the old entry after every operator has re-verified. Secrets go in through CLI stdin or masked cards only, never tool arguments or chat.

## 7. Open before slice 1 (Platform's known issues, 22 Oct 2026)

- Setting `ADMIN_AUTH_DATABASE_URL` and `BETTER_AUTH_SECRETS` on Vercel staging needs a staging DB URL and a Vercel token on the box, and the values go in only through a masked input.
- `admin_auth_app` would inherit PUBLIC execute: 101 `public` functions on staging (15 SECURITY DEFINER), 103 on prod (15). Needs `revoke execute … from public` or a role that cannot reach `public`.
- Better Auth 1.7.6 `twoFactor.verified` defaults to `true`. The table must not default `verified` to true.
- `rateLimit` has no `id` in Better Auth core. Key the table on `key`, or add an `id` it will not write.

Slice 1 is unblocked as a staging draft once these four land.
