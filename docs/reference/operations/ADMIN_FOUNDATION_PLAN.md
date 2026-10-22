---
owner: ops-billing
last_reviewed: 2026-10-22
---

# Super Admin rebuild, step 1: foundation build plan

> **Status: parked, plan only, not approved for build (Alvin, 22 Oct 2026 08:23 EAT).**
>
> **22 Oct 2026, slice 0:** no centred modals in Admin. `ConfirmDialog` and `StepUpDialog` below are built as `OpsConfirm` and `StepUpSheet` (bottom sheet on phones, side drawer at `md`+). See `docs/reference/design-system/OPS.md` §3.
> Source of the parked decision: relayed by Scalers Chief / Platform; not recorded elsewhere in the repo (unverified in repo).
> Copied verbatim from the Ops & Billing box brief `briefs/admin-foundation-plan.md` on 22 Oct 2026, with secrets and personal data redacted (see the PR body). Paths under `/workspace/` are box paths and are not in the repo.

Prepared 22 Oct 2026, 01:45 EAT, by Ops & Billing. Plan only: no code written, no PR opened, nothing pushed, no database touched.
Evidence: `origin/main` @ `eba04c72` (includes #857 and #858), read in a detached worktree at `/workspace/wt-admin-fplan`. Better Auth behaviour was checked against the installed `better-auth@1.7.6` source, not only the docs.
Builds on `docs/reference/operations/ADMIN_REBUILD_RESEARCH.md` (IA, tokens, components, analytics) and does not repeat it. Where this plan differs from that brief, it says so.

Skills applied: scalers-context, scalers-repo-workflow, ops-and-billing-lane, super-admin-product, admin-end-to-end-polish, ui-ux-pro-max-scalers.

---

## 0. What step 1 delivers

When step 1 is done, on staging:

1. `/admin` renders in a new shell (labelled grouped sidebar, top bar with ⌘K and an environment band) when `ADMIN_V2=on`. With the flag off, the current Admin is byte-for-byte what it is today.
2. Every existing Admin page works inside the new shell unchanged. New modules appear in the nav only when they exist; nothing says "Coming soon".
3. An `ops` design layer exists: tokens, type, density, table, chart, dialog and drawer primitives, with a staging-only kit page that renders every state in light and dark.
4. Admin sessions live in Postgres (revocable), operators are real rows, and every sensitive write asks for a 6-digit authenticator code even when the operator is signed in. Email code via Resend is the backup. No SMS.
5. A module registry tells later steps exactly where they plug in: route, nav group, sensitive actions, and the "Needs attention" feed.

Not in step 1: rebuilding any module's content (Businesses, Billing, Numbers and so on), analytics data, billing on the 1st, or the non-payment ladder. Those are steps 2 to 9 and land on this foundation.

---

## 1. What the code says today (constraints this plan is built around)

| Fact | Where | Consequence |
| --- | --- | --- |
| Better Auth has **no database**. Sign-in is a custom plugin that builds a `User` and `Session` in memory and writes only a 14-day JWE cookie. | `lib/admin-auth.ts` (`cookieCache` 14 d, no `database`), `lib/admin-auth-plugin.ts` (`setSessionCookie` with `generateId()`) | Sessions cannot be revoked or listed. The twoFactor plugin cannot work without tables. Step-up needs a DB first. |
| Operators come from env `ADMIN_OPERATORS=user:code` (or one shared `ADMIN_ACCESS_CODE`). User id is synthetic `admin:<username>`; email is `<username>@admin.scalers.internal`. | `lib/adminOperators.ts`, plugin | No real email to send a backup code to. Keep `admin:<username>` as the id so audit actors do not change. |
| `isAdminAuthenticated()` also accepts the legacy HMAC cookie (`scalers_session`, `sauti_desk_session`), and `isLegacyAuthenticated` is the same function. 8 write routes use it. | `lib/auth.ts:36-53`; `api/admin/{packages,package-versions,wallets,voices,platform-ops,buy-number}`, `api/did-pool` | A legacy cookie has no operator and no session id, so it can never satisfy step-up. Sensitive routes must require a real operator session. |
| twoFactor's sign-in challenge only hooks `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`. | `plugins/two-factor/index.mjs:244-246` | Our `/sign-in/access-code` is not intercepted. Good for step-up-only; sign-in 2FA would need our own hook. |
| With an active session, `verify-totp` / `verify-otp` skip the attempt limit and the account lockout (both run only when `isSignIn`). They also return 200 without recording anything. | `two-factor/totp/index.mjs:174-204`, `verify-two-factor.mjs:101-118` | Calling the plugin alone gives unlimited guesses and no proof. We add our own limiter and our own grant record. |
| With `allowPasswordless: true` (needed: operators have no password), `/two-factor/enable` and `/two-factor/disable` need only a session. | `index.mjs:105-113`, `utils/password.mjs` `shouldRequirePassword` | A stolen session could disable 2FA and enrol its own phone. Those endpoints must themselves require a fresh step-up. |
| TOTP secrets and backup codes are encrypted with the auth secret. Better Auth 1.7 supports versioned `BETTER_AUTH_SECRETS=2:…,1:…`. | `index.mjs:133-138`, `context/secret-utils.mjs` | Rotating `BETTER_AUTH_SECRET` the old way would brick every enrolment. Rotation must use the versioned list. |
| Email design system exists: `packages/email` with `withEnv` (`[PRODUCTION]` / `[STAGING]` subject and band). Desk cannot run React Email, so templates are exported statically with a drift test. | `packages/email/src/env.ts`, `catalog.ts`, `npm run export:ops-wallet` | The backup-code email is a new `packages/email` kind, exported the same way. |
| Tokens live in `globals.css` (`--canvas`, `--surface*`, `--ink*`, `--accent*`, `--ok`, `--attention`, `--lead`). Radius scale 6/10/16 in `tailwind.config.ts`. | `dashboard/src/app/globals.css`, `dashboard/tailwind.config.ts` | The Ops layer reuses these roles and adds density, status and chart tokens. |
| Charter: "One `AppShell` for desk and admin", "One `ListRow` … Admin lists", "Same shell, same kit", 6-item admin nav. | `docs/explanation/frontend/FRONTEND_2_0_CHARTER.md` lines 36, 37, 80, 88, 170 | Amendment needed before any Ops-layer UI merges (slice 0). |
| Libraries: research brief picked TanStack Table **v8**. npm today: `@tanstack/react-table` latest is **9.3.1** (v8 last release 8.21.3, Apr 2025). `recharts` 3.10.1, `@tanstack/react-virtual` 3.14.21, `pg` 8.23.1. | `npm view`, 22 Oct 2026 | **Correction:** use TanStack Table v9 (current stable). Its API differs from v8; slice 6 budgets for that. |
| Open docs PR #812 "Super Admin billing IA research" overlaps this IA. | `gh pr list` | Close or fold into slice 0 so there is one IA doc. |

---

## 2. The Ops design system (Admin only)

### 2.1 Grounding

The research brief (§2) already sets the tokens. This section records what the reference consoles do that we copy, and the decisions that follow.

| Reference | What it does | What we take |
| --- | --- | --- |
| **Vercel Geist** | 13px is the workhorse in dense views: `label-13` (13/16) next to labels, `copy-13` (13/18) "where space is a premium", tabular figures for numbers; headings 14/20, 16/24, 20/26, 24/32 at weight 600 ([Geist typography](https://vercel.com/geist/typography)). | Body 13/18, label 12/16, heading 15/20, title 20/26. Tabular numerals everywhere numbers align. |
| **Linear** (2024 redesign, Mar 2026 refresh) | Raised density and contrast; then made the sidebar "a few notches dimmer" so content leads, cut icon use, softened and removed separators: "structure should be felt, not seen" ([Linear refresh](https://linear.app/now/behind-the-latest-design-refresh), [2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)). Themes generated in LCH. | Sidebar on `--surface-2` tone with `--ink-2` labels, active row in `--ink`. Separate by tone, not lines. Icons only where they carry meaning (status, provider). |
| **Stripe Dashboard** | Spacing tokens 2/4/8/16/24/32/48; "tighter = more related"; overview = one row of 3 to 5 KPI tiles, then a two-column body that fills the width; fixed chart heights so nothing jumps ([Stripe Apps style](https://docs.stripe.com/stripe-apps/style), [chart layout](https://docs.stripe.com/stripe-apps/patterns/chart-layout)). Test mode is marked across the whole UI. | 4px grid (4/8/12/16/24/32). Section gap 24. KPI row max 6 tiles. Chart containers have fixed heights (180 in tiles, 280 in pages). Environment band always on. |
| **Retool** | Table row height presets X-Small 20 / Small 32 / Medium 48 / Large 60 ([Retool table](https://docs.retool.com/apps/guides/data/table/customization)). | Row presets 28 / 36 / 44 (36 default; 44 is the touch size below `lg`). 20px is too tight for KSh amounts and pills. |
| **IBM Carbon, Polaris, Primer** (brief §2) | Table densities 24 to 64; URL-synced table state; right-aligned numbers; one data point per column. | Already in the brief. Kept. |

### 2.2 Token set (lands in slice 2)

All tokens are CSS variables scoped to `.ops-theme`, defined once in `dashboard/src/styles/ops.css` and imported only by the Admin layout. No hex in components. New hex values appear only in that file.

| Group | Tokens | Values |
| --- | --- | --- |
| Type | `--ops-text-kpi`, `-title`, `-heading`, `-body`, `-label`, `-caption` | 28/32 600 · 20/26 600 · 15/20 600 · 13/18 400 · 12/16 500 · 11/14 400. Font `--font-sans` (shared). `font-variant-numeric: tabular-nums` on `.ops-num`. |
| Space | `--ops-space-1…6` | 4, 8, 12, 16, 24, 32 |
| Density | `--ops-row-compact`, `--ops-row`, `--ops-row-touch` | 28, 36, 44. Toolbar height = row height. Cell padding x 12. |
| Radius | reuse `sm` 6, `lg` 10 | Controls and cells 6; cards, drawers, dialogs 10; pills full. |
| Surface | reuse `--canvas`, `--surface`, `--surface-2`, `--surface-3`, `--hairline` | Sidebar `--surface-2`; content `--canvas`; tables `--surface`. No shadow at rest; `--shadow-menu` / `--shadow-sheet` only on drawer, popover, dialog, palette. |
| Status | `--ops-status-{ok,info,warn,danger,neutral,beta}` each with `-fg`, `-bg` | ok from `--ok`; info from `--accent`; warn from `--attention`; danger new (light `#B42318`, dark `#F97066`); neutral from `--ink-2`; beta from `--lead`. Every pill also carries the word (WCAG 1.4.1). |
| Environment | `--ops-env-prod`, `--ops-env-staging` | prod = danger; staging = accent. 3px band plus a pill with the word. |
| Chart | `--ops-chart-1…8`, `--ops-chart-seq-1…5`, `--ops-chart-up`, `--ops-chart-down` | Okabe-Ito based categorical set tuned in both themes; 5-step accent ramp; diverging accent vs danger. |
| Motion | none new | desk-motion verbs only (pending, live, land, shift, press). Recharts `isAnimationActive={false}`. |

Contrast gate: every fg/bg pair at 4.5:1 or better in both themes, checked by a unit test that parses `ops.css` (same approach as `tests/errorTextContrast.test.js`).

### 2.3 Primitives in step 1

Built in `dashboard/src/components/ops/**`, used only under `/admin`. Desk kit (`components/ui/**`) is not forked; where an Ops control is a Desk control at a smaller size (Field, Select, Segmented, Switch), it gets an `size="ops"` variant reviewed by Desk.

`OpsShell`, `Sidebar`, `TopBar`, `EnvBand`, `CommandPalette` (on existing `/api/admin/search` and `@base-ui/react`), `PageHeader` (title, count, actions; no subtitle sentence), `StatusPill`, `Money` / `MoneyCell` (integer KSh in, `en-KE` format, "KSh 0" never blank), `KpiTile`, `Sparkline` (server SVG), `DataTable` + `FilterBar` + `SavedViews` + `BulkBar` + CSV, `Drawer`, `ConfirmDialog` (light / money / destructive), `StepUpDialog`, `EmptyState`, `ErrorState`, `Skeleton` (shaped), chart wrappers (`ChartFrame`, `TimeSeries`, `BarPair`, `AgingBar`, `DivergingBar`) with "View as table".

Copy rules are the brief's §5, enforced by a banned-word test over `lib/ops/copy/*.ts`.

---

## 3. Layout and IA behind `ADMIN_V2`

### 3.1 Nav

Overview is the home. Under it, 12 modules in 4 groups:

| Group | Module | Route | Step 1 state |
| --- | --- | --- | --- |
| Overview | Overview | `/admin` | Today's content inside the new shell |
| Operate | Businesses | `/admin/businesses` | v1 page inside shell |
| | Numbers | `/admin/numbers` | v1 page inside shell |
| | Quality | `/admin/quality` | v1 page inside shell |
| | Voices | `/admin/voices` | v1 page inside shell |
| Money | Billing (Invoices, Payments, Collections, Credit notes) | `/admin/billing/*` | Invoices and Payments v1 inside shell; Collections and Credit notes hidden |
| | Packages and pricing | `/admin/packages` | v1 page inside shell |
| | Usage and costs | `/admin/usage` | hidden (step 8) |
| Insights | Analytics | `/admin/analytics/*` | hidden (step 8) |
| System | Platform health | `/admin/platform` | v1 page inside shell |
| | Notifications | `/admin/notifications` | hidden (steps 3, 4) |
| | Audit log | `/admin/audit` | v1 Activity inside shell at `/admin/activity`; `/admin/audit` arrives with the audit feed |
| | Settings | `/admin/settings` | **new in step 1**: Settings › Security only (authenticator, backup codes, email backup, sessions) |

Hidden means not in the nav, not in ⌘K, and the route 404s. No "Coming soon" rows.

### 3.2 How the flag works

- Same URLs for v1 and v2. No `/admin/v2/*` prefix, so bookmarks and alert links keep working and nothing needs redirecting when v1 is retired.
- `app/admin/(console)/layout.tsx` reads `adminV2Enabled(operator)` once. On: `OpsShell`. Off: today's `AdminShell`. Pages do not know which shell they are in until their module is rebuilt.
- `ADMIN_V2` values: `off` (default), `on`, or a comma list of usernames (`alvin`) so one operator can run v2 on prod data while v1 stays the default. Parsed by `lib/adminV2.ts` (on the same `envFlagOn` pattern as `deskFeatureFlags.ts`).
- A rebuilt module sets `v2: true` in the registry; its page then renders the v2 view when the shell is v2 and the v1 view otherwise. v1 components are deleted only in the cleanup step after parity sign-off.
- `/admin/login` is unchanged and shared.

### 3.3 Shell geometry

- `md+` (768): 232px sidebar, collapsible to 56 with ⌘\ ; top bar 48px with breadcrumb, ⌘K field, env pill, operator menu (Appearance, Security, Sign out). Content fluid to 1600px, 24px gutters. Right drawer slot 480 to 640px.
- Below `md`: top bar plus a sheet nav. Money and number writes are allowed on phone, with the same step-up rules as desktop (per Scalers Chief relaying Alvin, 22 Oct 16:55 EAT). Confirms and step-up use the bottom sheet.
- Environment: 3px band at the very top plus a pill: "Production" (danger) or "Staging" (accent). Read from `ADMIN_ENV` (`production` | `staging`); if unset, derived from the Supabase project ref; if that is unknown, shown as Production. Wrong-red is safer than wrong-blue.
- Keyboard: ⌘K palette, `/` search, `g` then a letter to jump module (`g b` Businesses, `g n` Numbers, `g i` Invoices), `?` shortcut list, `Esc` closes drawer and returns focus to the row.

### 3.4 Module registry (the plug-in contract)

One typed list in `dashboard/src/lib/ops/modules.ts` replaces `ADMIN_LINKS` for the v2 shell (v1 keeps `adminLinks.ts` untouched). Each entry declares:

| Field | Purpose |
| --- | --- |
| `id`, `label`, `group`, `href`, `children` | Nav, breadcrumb, ⌘K "Go to" commands |
| `status` | `hidden` / `v1` / `v2` |
| `attention` | Optional server function returning Needs-attention rows `{ severity, count, label, href }`. Overview renders the merged list (max 8 rows), replacing the hand-built Today queue over time. |
| `intents` | The sensitive actions this module can perform, by id from `lib/adminSensitive.ts`, so ⌘K commands and buttons know which ones will ask for a code. |
| `owner` | Lane that owns its data and behaviour (for review routing) |

---

## 4. Step-up verification (OTP for sensitive actions)

### 4.1 What counts as sensitive, and how often it asks

Two tiers, so routine money work is not a code per click while irreversible or high-value actions always ask. OWASP: bind step-up to the specific action and enforce it server-side ([OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)). GitHub's sudo mode is the window model (2 h, sliding) ([GitHub sudo mode](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode)); ours is shorter and fixed because these are money and telephony writes.

**Tier A: one code opens a 15-minute window for this session** (fixed from verification; not extended by activity).

| Intent id | Current endpoint / action |
| --- | --- |
| `billing.grant_minutes` | `POST /api/admin/billing` `grant_minutes` |
| `billing.package.assign` | `billing` `assign_package`, `unassign_package` |
| `billing.checkout_review.resolve` | `billing` `resolve_checkout_review` |
| `pricing.rates.save`, `pricing.package.save` | `POST /api/admin/packages` `save_rates`, `save_package` |
| `pricing.version.publish` | `POST /api/admin/package-versions` `publish`, `approve`, `archive`, `move_subscribers`, `set_price_approval_threshold` |
| `numbers.pool.release`, `numbers.pool.assign` | `POST /api/did-pool` `release`, `assign_next`, `assign_specific`; `POST /api/admin/businesses` `release_did`, `assign_next` |
| `business.archive`, `business.transfer_owner` | `businesses` `archive`, `transfer_owner` |
| `payments.record` (≤ KES 20,000) | step 7 `record_manual_payment` |
| `ledger.adjust` | ledger credit/debit (when rebuilt) |

**Tier B: a fresh code for every action, bound to that exact action, single use, valid 5 minutes.**

| Intent id | Current endpoint / action |
| --- | --- |
| `switch.billing_flag` | `POST /api/admin/billing/flags` (`bachs_mode`, `live_master`, `billing_notices`, `desk_plan_change`, `package_editor`, `signup_trial`) |
| `switch.billing_mode` | `billing` / `package-versions` / `wallets` `set_billing_mode`, `set_new_signup_trial` (anything that starts or stops charging) |
| `numbers.buy` | `POST /api/admin/buy-number` (spends SautiKit money; step 6 auto-buy approval) |
| `numbers.provider_release` | step 6 SautiKit `DELETE /v1/numbers/{id}` (no refund) |
| `payments.record_large` (> KES 20,000) | step 7 |
| `security.factor_change` | enrol a new authenticator, disable, regenerate backup codes, change backup email |
| `operators.change` | add, disable, change role (when operators move off env) |

The action digest is `sha256(intent | target id | amount | new value)`. The dialog shows the same facts in words ("Turn on live payments on Production"), so the code is approved for what the operator reads.

Not step-up: reads, search, voice catalogue edits, profile edits, pay-link creation, sending a test email. Typed confirmation (`REMOVE`, business name, `PRODUCTION`) stays where it is today and is additional to the code.

### 4.2 Factors

| Factor | Role | Settings |
| --- | --- | --- |
| Authenticator app (TOTP) | Primary, required for every operator | 6 digits, 30 s, ±1 step (Better Auth default). Issuer `Scalers Admin` on prod and `Scalers Admin staging` on staging so the two entries never get mixed up in the app. |
| Email code via Resend | Backup only (lost or new phone). Weaker: it inherits the security of the inbox ([OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)). | 6 digits, 5 min, stored hashed (`storeOTP: "hashed"`; the default is plain), single use, max 3 sends per 15 min. Sent from `Scalers ops <[redacted ops sender address]>` as new `packages/email` kind `admin_step_up_code`, env-tagged. Every use also sends an `admin_security_alert`. |
| Backup codes | Last resort | 10 single-use codes shown once at enrolment. Using one sends an `admin_security_alert`. |
| SMS | None | Not offered. |

Email content (`admin_step_up_code`): subject `[PRODUCTION] Admin verification code` (code not in the subject, so it does not show on a lock screen); body: the code, the action it approves, "Expires 01:50 EAT", and one line: "Didn't ask for this? Someone has your access code. Change it now." No other copy.

### 4.3 Session and step-up window

| Item | Today | Step 1 |
| --- | --- | --- |
| Where the session lives | JWE cookie only, 14 days, not revocable | Row in `admin_auth.session`; cookie `__Secure-admin.session_token` (httpOnly, Secure, SameSite=Lax) plus a 5-minute `admin.session_data` cache cookie. A revoked session stops working within 5 minutes everywhere and immediately for step-up checks (they bypass the cache). |
| Sign-in | username + access code | unchanged |
| Session length | 14 days | 12 hours hard cap (`expiresIn` 12 h, `updateAge` 12 h so it never slides). NIST SP 800-63B-4 caps AAL2 sessions at 24 h with a 1 h inactivity limit ([NIST 800-63B-4 §2.2.3](https://pages.nist.gov/800-63-4/sp800-63b.html)); access code alone is one factor, so we stay well inside that. |
| Step-up window | none | Tier A: 15 min fixed per session. Tier B: per action, 5 min, single use. Signing out, session expiry, or revoking the session deletes its grants (FK cascade). |
| Failed codes | n/a | 5 wrong codes in 15 min (any factor) locks step-up for that operator for 15 min, writes an audit row and sends `admin_security_alert`. Counted in `admin_auth.two_factor.failed_verification_count` / `locked_until` (columns the plugin already has). |
| TOTP replay | n/a | A TOTP code accepted once cannot be accepted again for 90 s for that operator (covers the ±1 step window). |
| Not enrolled | n/a | Sensitive actions answer `403 step_up_enrolment_required`; dialog links to Settings › Security. |
| Legacy HMAC cookie / `DASHBOARD_OPEN` | accepted by `isAdminAuthenticated` | Sensitive routes answer `403 operator_session_required`. Step-up fails closed in production whatever the dev flags say. |

### 4.4 Request flow

1. Operator clicks "Turn on live payments". The client calls the route through `adminFetch()` (new wrapper used by v1 panels and v2 views).
2. Route calls `requireStepUp(request, intent, facts)` first thing after the operator check. No valid grant: `403 { error: "step_up_required", intent, tier, digest }`.
3. `adminFetch` opens `StepUpDialog` with the action in words. Operator types the code. Dialog posts to `POST /api/admin/step-up` `{ method, code, intent, digest }`.
4. `/api/admin/step-up` (route handler, server only): reads the session with `disableCookieCache`; checks lock; calls `adminAuth.api.verifyTOTP` / `verifyTwoFactorOTP` / `verifyBackupCode` with the request headers; on success inserts a row in `admin_auth.step_up_grant` (window or action-bound) and an `ops_audit_log` row `admin.step_up.verified`; on failure increments the counter and audits `admin.step_up.failed`.
5. `adminFetch` retries the original request once. `requireStepUp` finds the grant; for Tier B it consumes it atomically (`update … set consumed_at = now() where id = $1 and consumed_at is null returning id`). The action's own audit row carries `detail.step_up = { grant_id, method }`.

A small Better Auth plugin (`adminStepUpGuard`) adds a `before` hook on `/two-factor/enable`, `/two-factor/disable`, `/two-factor/generate-backup-codes`, `/two-factor/get-totp-uri`, `/two-factor/view-backup-codes`: allowed only with a fresh `security.factor_change` grant, or, for first enrolment only, when the operator has no verified factor and has just confirmed an email code. `trustDevice` is rejected on every verify call.

Rollout switch `ADMIN_STEP_UP`: `off` → `observe` (logs `admin.step_up.would_block`, never blocks) → `enforce`. Staging goes to `enforce` as soon as slice 6 lands; prod moves one stage at a time with Alvin's yes.

### 4.5 Tables Platform must create

One new SQL file, `docs/supabase/admin_auth.sql` (+ `admin_auth_down.sql`), added to `docs/supabase/README.md` apply order and `MIGRATION_LEDGER.md`. Apply to staging (`sgcdncjxauhsbunobmob`) first; prod (`fjxcdccgyhnvnnlnovcl`) only with Alvin's yes. Column names below are snake_case; Better Auth maps to them through `fields` in the config, and the slice-3 PR runs `npx @better-auth/cli generate` against that config to prove the shapes match 1.7.6 exactly before Platform applies.

```sql
-- Own schema: not in Supabase "Exposed schemas", so PostgREST, anon and authenticated never see it.
create schema if not exists admin_auth;
revoke all on schema admin_auth from public, anon, authenticated;

-- Least-privilege login role for the Desk server (not service_role, not postgres).
-- Password set by Platform; stored only as ADMIN_AUTH_DATABASE_URL in Vercel (staging and prod separately).
create role admin_auth_app login noinherit;
alter role admin_auth_app set search_path = admin_auth, pg_catalog;
grant usage on schema admin_auth to admin_auth_app;

create table admin_auth."user" (
  id                  text primary key,              -- 'admin:<username>' (keeps audit actor ids)
  name                text not null,
  email               text not null unique,          -- operator's real inbox, used for backup codes
  email_verified      boolean not null default false,
  image               text,
  username            text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  role                text not null default 'ops' check (role in ('owner','ops','viewer')),
  disabled_at         timestamptz,
  two_factor_enabled  boolean not null default false, -- twoFactor plugin field
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table admin_auth.session (
  id          text primary key,
  user_id     text not null references admin_auth."user"(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on admin_auth.session (user_id);

-- Required by Better Auth core even though no OAuth or password rows will exist.
create table admin_auth.account (
  id                        text primary key,
  account_id                text not null,
  provider_id               text not null,
  user_id                   text not null references admin_auth."user"(id) on delete cascade,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index on admin_auth.account (user_id);

-- Email codes, 2FA challenge state, enrolment tokens.
create table admin_auth.verification (
  id          text primary key,
  identifier  text not null,
  value       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on admin_auth.verification (identifier);

-- twoFactor plugin table.
create table admin_auth.two_factor (
  id                         text primary key,
  user_id                    text not null unique references admin_auth."user"(id) on delete cascade,
  secret                     text not null,          -- encrypted with BETTER_AUTH_SECRETS
  backup_codes               text not null,          -- encrypted
  verified                   boolean not null default false,
  failed_verification_count  integer not null default 0,
  locked_until               timestamptz
);
create index on admin_auth.two_factor (secret);

-- Better Auth rate limiter (storage: "database"); memory storage does not work across Vercel instances.
create table admin_auth.rate_limit (
  id            text primary key,
  key           text not null unique,
  count         integer not null,
  last_request  bigint not null
);

-- Ours: proof that this session passed step-up, for what, until when.
create table admin_auth.step_up_grant (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references admin_auth."user"(id) on delete cascade,
  session_id     text not null references admin_auth.session(id) on delete cascade,
  method         text not null check (method in ('totp','email','backup_code')),
  scope          text not null check (scope in ('window','action')),
  intent         text,                                -- set for scope = 'action'
  intent_digest  text,                                -- sha256(intent|target|amount|value), scope = 'action'
  totp_step      bigint,                              -- replay guard
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,                         -- action grants are single use
  ip_address     text,
  user_agent     text,
  check ((scope = 'action') = (intent_digest is not null))
);
create index on admin_auth.step_up_grant (session_id, expires_at);
create index on admin_auth.step_up_grant (user_id, granted_at desc);

-- Belt and braces: RLS on, one policy for the app role only.
do $$ declare t text; begin
  foreach t in array array['user','session','account','verification','two_factor','rate_limit','step_up_grant'] loop
    execute format('alter table admin_auth.%I enable row level security', t);
    execute format('create policy admin_auth_app_all on admin_auth.%I for all to admin_auth_app using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on admin_auth.%I to admin_auth_app', t);
  end loop;
end $$;

-- Housekeeping (pg_cron, daily 03:00 EAT): delete expired sessions, verifications, grants older than 90 days.
```

Seed (Platform, by hand, values from Alvin): one `admin_auth."user"` row per operator: `id = 'admin:<username>'`, `username`, `name`, real `email`, `role`. Sign-in refuses an operator with no row or with `disabled_at` set. Access codes stay in `ADMIN_OPERATORS` for step 1.

Audit: no new audit table. Step-up and security events go to the existing `public.ops_audit_log` through `recordAdminAction` with actions `admin.step_up.verified`, `.failed`, `.locked`, `.would_block`, `admin.2fa.enrolled`, `admin.2fa.reset`, `admin.session.revoked`. The union view `admin_audit_feed` (brief §4.4) is a later Platform item; the Audit log module reads it.

Env vars (names only): `ADMIN_AUTH_DATABASE_URL` (Supavisor transaction pooler, port 6543, user `admin_auth_app`), `BETTER_AUTH_SECRETS` (versioned; replaces single-secret rotation), `ADMIN_V2`, `ADMIN_STEP_UP`, `ADMIN_ENV`, `ADMIN_AUTH_DB` (cutover switch, below). Existing `RESEND_API_KEY`, `OPS_EMAIL_FROM` are reused.

Break-glass (runbook in slice 0): if an operator loses phone and backup codes and inbox, Platform deletes that operator's `admin_auth.two_factor` row in the SQL editor, writes an `ops_audit_log` row by hand, and the operator re-enrols with an email code. Only with Alvin's yes in chat.

---

## 5. Where later modules plug in

| Roadmap step | Module(s) in the registry | Sensitive intents it adds | Needs-attention rows it feeds | Data it needs (Platform) |
| --- | --- | --- | --- | --- |
| Balance alerts (shipped #857) | System › Platform health (provider table: state, balance, runway, last check); Notifications log | none (read-only) | "SautiKit prod: KES 28, 3 days to renewal" | existing `platform_ops_*`, ops-alerts cron |
| 2 Billing on the 1st | Money › Billing › Invoices (billing run view); Settings › Billing run | `billing.run.approve` (Tier B on prod) | "Billing run waiting for approval", "3 invoices failed to issue" | invoice builder, `invoices.due_at` not null, `invoice_lines.kind` |
| 3 Invoice emails and reminders | System › Notifications (queued / sent / failed, rendered body) | `notices.pause_all` (Tier B) | "2 notices failed" | `billing_notices` rendered body + delivery status |
| 4 Non-payment ladder | Money › Billing › Collections; Settings › Collections ladder | `collections.stage.change` (A), `business.suspend_for_nonpayment` (B) | "2 invoices overdue · KSh 14,000" | `collection_cases` |
| 5 On-demand caps and trust tiers | Businesses detail › Billing tab; Settings › Caps and tiers | `billing.cap.set` (A), `billing.tier.change` (A) | "Esga at 90% of cap" | caps / tier columns |
| 6 Numbers: release, release queue, auto-buy | Operate › Numbers with tabs Pool · Release queue · Buy | `numbers.pool.release` (A), `numbers.provider_release` (B), `numbers.buy` (B); auto-buy approval card is a Tier B step-up | "1 business waiting for a number", "2 numbers idle > 30 days · KSh 1,000/month" | idempotency key + expected price on claim; release queue table |
| 7 Manual payments | Billing › Payments "Record payment"; invoice drawer action | `payments.record` (A ≤ 20k), `payments.record_large` (B > 20k) | "1 payment needs review" | `record_manual_payment` RPC, `payments.method/reference/fee/net` |
| 8 Costs, margin, revenue and churn analytics | Money › Usage and costs; Insights › Analytics (Revenue, Retention, Collections, Margins, Usage) | none | "Gross margin MTD below 60%" | `call_costs`, `provider_rates`, `billing_metrics_daily`, `subscription_events` |
| 9 Beta usage display | Businesses list columns; Analytics › Usage "beta shadow MRR" | none | none | existing usage |
| Notifications | System › Notifications | `notices.resend` (light confirm, no code) | failed sends | as step 3 |
| Audit log | System › Audit log (absorbs Activity) | none (append-only) | none | `admin_audit_feed` view |

Every row above is one registry entry change plus its own module PR. None of them touches the shell, the tokens or the step-up code.

---

## 6. Slices (PR-sized, in merge order)

Rules for every slice: one lane, draft PR into `main` (staging rebuild picks it up via `stage-pull-request.yml`), under ~600 changed lines excluding tests, gates `npm run test:voice`, `npm run test:mvp`, `cd dashboard && npm run lint && npm run build`, plus the slice's own tests. New node tests are added to the `test:mvp` list like the existing `tests/admin*.test.js`. Nothing merges to `main` without Alvin's yes in my chat. Builds run on the box under Alvin's Admin-rebuild approval; Desk Engineer reviews presentation slices, Platform reviews auth slices.

Two tracks run side by side after slice 1: **auth** (3 → 4 → 5 → 6) waits on Platform's SQL; **design** (2 → 7 → 8 → 9) does not.

| # | Slice | Lane | Files touched | Tests | Staging check |
| --- | --- | --- | --- | --- | --- |
| 0 | **Docs and sign-off.** Charter amendment for `/admin` (lines 36, 37, 80, 88, 170), `OPS.md` design layer spec, IA + module registry contract, step-up spec + break-glass runbook. Close or fold PR #812. | Desk (author Ops) | `docs/explanation/frontend/FRONTEND_2_0_CHARTER.md`, new `docs/reference/design-system/OPS.md`, `docs/reference/design-system/pages/admin.md`, new `docs/reference/platform/ADMIN_STEP_UP.md`, `docs/operations/SUPER_ADMIN_REQUIREMENTS.md` | docs-only; existing docs link check | none (no runtime). Sign-off: Desk Engineer + Scalers Chief, then Alvin. |
| 1 | **Auth schema.** `admin_auth.sql` + down + apply order + ledger; seed of operator rows; pg_cron cleanup. | Platform | `docs/supabase/admin_auth.sql`, `admin_auth_down.sql`, `README.md`, `MIGRATION_LEDGER.md` | SQL static test (file parses, every table has RLS + policy, no grant to anon/authenticated), same style as `factConfirmV2Sql.test.js` | Applied on staging. As `anon` via PostgREST: `admin_auth` not reachable. As `admin_auth_app`: CRUD works. `admin_auth` absent from Exposed schemas. |
| 2 | **Ops tokens + base primitives.** `ops.css`, Tailwind `ops-*` keys (additive), `StatusPill`, `Money`, `Skeleton`, `EmptyState`, `ErrorState`, `KpiTile`, `Sparkline`, `ConfirmDialog` (3 strengths, no step-up yet), `Drawer`, `PageHeader`; staging-only kit page `/admin/_kit`. | Ops build, Desk review | new `dashboard/src/styles/ops.css`, `dashboard/tailwind.config.ts`, new `dashboard/src/components/ops/*`, new `dashboard/src/app/admin/(console)/_kit/page.tsx`, new `dashboard/src/lib/ops/format.ts` | contrast test over `ops.css`; `Money` formatting unit test (0, negatives, 1,000,000); banned-word copy test; Playwright `opsKit.spec.ts` screenshots 1280 / 768 / 390 light + dark; axe on the kit page | `/admin/_kit` on staging renders every primitive and state in both themes; 404 on prod build (guarded by `ADMIN_ENV`). Desk visual sign-off. |
| 3 | **Admin sessions in Postgres.** Add `pg`; Better Auth `database` pool (max 1, transaction pooler); snake_case `fields` mapping; access-code plugin creates the session through `internalAdapter.createSession` and refuses unknown or disabled operators; 12 h session; 5 min cookie cache; `BETTER_AUTH_SECRETS`; `ADMIN_AUTH_DB=on/off` cutover switch (off = today's stateless path). | Platform (auth client); Ops may author | `dashboard/package.json`, `dashboard/src/lib/admin-auth.ts`, `lib/admin-auth-plugin.ts`, new `lib/adminAuthDb.ts`, `lib/auth.ts` (`getAdminSession` exposes session id), `app/api/admin/session/route.ts` | extend `tests/adminAuth.test.js` (unknown operator refused, disabled refused, session row written, sign-out deletes row); `adminGuard.test.js` unchanged and green; CLI `generate` diff vs `admin_auth.sql` is empty | Staging: sign in as alvin → row in `admin_auth.session`; delete the row → signed out within 5 min; flip `ADMIN_AUTH_DB=off` → old path still signs in. Owner session still bounced from `/admin`. |
| 4 | **Step-up server.** twoFactor plugin (`allowPasswordless`, issuer per env, `storeOTP: "hashed"`, OTP 5 min, 10 backup codes, `rateLimit.storage: "database"`); `adminStepUpGuard` plugin (before-hooks on enable/disable/backup codes/TOTP URI; rejects `trustDevice`); `POST /api/admin/step-up`; `lib/adminStepUp.ts` (`requireStepUp`, grant create/consume, limiter, replay guard, `ADMIN_STEP_UP` modes); `lib/adminSensitive.ts` (intent catalogue + tiers + digest). | Ops (Platform review) | `lib/admin-auth.ts`, new `lib/adminStepUpGuard.ts`, new `lib/adminStepUp.ts`, new `lib/adminSensitive.ts`, new `app/api/admin/step-up/route.ts` | new `tests/adminStepUp.test.js`: window grant valid 15 min then not; action grant single use and digest-bound; 5 failures → locked 15 min; TOTP replay rejected; legacy cookie → `operator_session_required`; `observe` never blocks; enable/disable blocked without grant; `trustDevice` rejected | Staging, with a test operator: `curl` the step-up route with wrong codes 5× → 429 locked + audit rows; correct code → grant row with `expires_at` = +15 min. |
| 5 | **Step-up UI + enrolment + email.** Settings › Security (enrol authenticator with QR rendered locally, backup codes shown once, email backup, active sessions with revoke); `StepUpDialog`; `adminFetch` wrapper; `packages/email` kinds `admin_step_up_code` + `admin_security_alert` with static export and drift test. | Ops build, Desk review (UI) | new `app/admin/(console)/settings/security/page.tsx`, new `components/ops/StepUpDialog.tsx`, new `lib/adminFetch.ts`, `packages/email/src/templates/ops.ts`, `packages/email/src/catalog.ts`, export script + generated `dashboard/src/lib/adminSecurityTemplates.ts`, `lib/opsMail.ts` (send helper only) | email render tests (env tag, code not in subject, plain-text part); drift test; Playwright `adminStepUp.spec.ts` with a staging test operator whose TOTP secret is in `E2E_ADMIN_TOTP_SECRET` | Alvin enrols on staging with his phone (entry shows "Scalers Admin staging"). Email backup arrives tagged `[STAGING]` from the ops sender. Revoking another session signs that browser out. |
| 6 | **Enforce on sensitive routes.** Call `requireStepUp` in every route in §4.1; those routes require an operator session (legacy HMAC refused there); v1 panels switch their write calls to `adminFetch` so the dialog appears in the old Admin too; each action's audit row carries `step_up`. | Ops | `api/admin/billing/route.ts`, `billing/flags/route.ts`, `api/admin/packages/route.ts`, `package-versions/route.ts`, `wallets/route.ts`, `businesses/route.ts`, `buy-number/route.ts`, `api/did-pool/route.ts`; write call sites in `components/AdminPaymentsStatus.tsx`, `AdminPackagesPanel.tsx`, `AdminPackageVersionsPanel.tsx`, `DidPoolManager.tsx`, `BuyNumberPanel.tsx`, `AdminShopMoneyPanel.tsx`, `AdminBusinessesPanel.tsx` | per route: no grant → 403 with intent; window grant → 200; Tier B second call with same grant → 403; `adminSafety.test.js` and `adminLifecycle.test.js` green; e2e assign → release → reassign with a code | `ADMIN_STEP_UP=observe` on staging for one day: `would_block` rows match the expected intents and nothing else. Then `enforce`: flip a staging billing flag (asks every time), grant minutes twice in 10 min (asks once). |
| 7 | **DataTable kit.** TanStack Table v9 + Virtual; sticky header and first column; sort, resize, hide, reorder; totals row; URL state; saved views (localStorage per operator for now); BulkBar; CSV export of current view. Shown on `/admin/_kit` with fixture data. | Ops build, Desk review | `dashboard/package.json`, new `components/ops/table/*`, `_kit` page | unit: URL state round-trip, CSV escaping, totals with integer KSh; Playwright: keyboard `j/k/Enter/Esc`, 2,000-row virtualised list scrolls without layout shift; axe | Kit page on staging at 1280 and 768; sort and filter survive reload via URL. |
| 8 | **Charts.** `recharts@3` behind `ChartFrame` (fixed heights, tokens via CSS vars, animation off, "View as table", "Updated 00:31 EAT" footer); `TimeSeries`, `BarPair`, `AgingBar`, `DivergingBar`; server `Sparkline` already in slice 2. Dynamic import so only chart routes load it. | Ops build, Desk review | `dashboard/package.json`, new `components/ops/charts/*`, `_kit` page | snapshot of "View as table" output; bundle check: `/admin/_kit` chart chunk not in other admin routes' first-load JS | Kit page shows each chart in both themes; reduced-motion shows no transitions. |
| 9 | **OpsShell + IA + `ADMIN_V2`.** `OpsShell`, `Sidebar`, `TopBar`, `EnvBand`, `CommandPalette` (registry + `/api/admin/search`), shortcuts, phone sheet nav and read-only rule; `lib/ops/modules.ts` registry; `lib/adminV2.ts`; layout switch; Overview renders today's Today content in the new shell; Settings › Security moves under System. | Ops build, Desk review | `app/admin/(console)/layout.tsx`, new `components/ops/shell/*`, new `lib/ops/modules.ts`, new `lib/adminV2.ts`, `lib/adminGlobalSearch*.ts` (commands added, search unchanged) | unit: flag parsing (`off`, `on`, `alvin,mercy`), registry (no hidden module in nav or ⌘K, every `href` resolves); `adminDeskShell.test.js` still passes with flag off; Playwright `opsShell.spec.ts`: every v1 route renders inside the shell at 1280 / 768 / 390, owner session still bounced, ⌘K reaches every visible module | `ADMIN_V2=on` on staging: click through all visible modules; assign → release → reassign works with step-up; flip `ADMIN_V2=off` → old rail back, nothing else changed. |

After slice 9 the foundation is done. Prod order, each on Alvin's yes: Platform applies `admin_auth.sql` on prod → `ADMIN_AUTH_DB=on` → operators enrol → `ADMIN_STEP_UP=observe` (1 week) → `enforce` → `ADMIN_V2=alvin`.

Rough size: slices 2, 3, 4, 6, 7, 9 are about 400 to 600 lines each; 0, 1, 5, 8 smaller. On the box, roughly one slice per working session.

---

## 7. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Plugin verify with a session has no attempt limit or lockout (checked in source) | Unlimited code guessing from a stolen session | Our limiter (5 per 15 min, lock 15 min, alert email) in `/api/admin/step-up`; Better Auth rate limiter with database storage on `/two-factor/*`. Tested in slice 4. |
| Passwordless enable/disable | Stolen session swaps the authenticator | `adminStepUpGuard` before-hooks; factor change is Tier B; every change emails `admin_security_alert`. |
| Cutover from cookie-only to DB sessions | Everyone signed out once; a DB problem blocks Admin sign-in | `ADMIN_AUTH_DB` switch to fall back; cut over at a quiet hour; Admin data is in the same Supabase anyway. |
| Serverless Postgres connections | Pool exhaustion on Vercel | Supavisor transaction pooler (6543), `max: 1`, short idle timeout; one tiny table set. |
| Secret rotation | Rotating `BETTER_AUTH_SECRET` the old way bricks every enrolment | `BETTER_AUTH_SECRETS` versioned list from slice 3; rotation runbook in slice 0. |
| Legacy HMAC cookie still accepted elsewhere | Non-sensitive admin writes still open to it | Sensitive routes refuse it in slice 6; Platform's P1 removes it everywhere (brief §6.2). |
| Email backup is the weakest factor | Inbox compromise = step-up bypass | Backup only; alert on every use; Alvin's backup inbox should have its own 2FA (question 5). |
| Wrong environment | Approving a prod switch thinking it is staging | Env band and pill, env in the dialog title, different issuer names in the authenticator app, `[PRODUCTION]` email tag. |
| Charter and skill say "same shell, same kit", "no competing design system" | Reviews block or later agents undo the Ops layer | Slice 0 sign-off first; Chief of Skills updates three skills (§8). |
| Two shells during transition | Drift, double maintenance | Same URLs, registry `status`, v1 code frozen except `adminFetch`; delete v1 per module only after parity. |
| Shared `tailwind.config.ts` | Accidental Desk visual change | Additive, `ops-` prefixed keys only; Desk reviews slice 2; Desk screenshot tests stay green. |
| TanStack Table v9 vs the v8 the brief assumed | Rework if examples are v8 | Pin 9.3.x; slice 7 is written against v9 docs; kit page proves it before any module uses it. |
| Bundle weight (Recharts ~116 KB gz) | Slower Admin first load | Dynamic import on chart routes only; checked in slice 8. |
| Operator friction | Codes feel like busywork and get bypassed | Tier A window; Tier B only for irreversible or high-value; `observe` week shows real frequency before `enforce`. |
| Cursor usage exhausted | All building is on the box | Slices sized for one session each; each still goes staging → Alvin's yes. |

---

## 8. What other lanes must do

**Platform Engineer**
1. Write and own `docs/supabase/admin_auth.sql` (+ down, README order, ledger) as in §4.5; create role `admin_auth_app`; confirm `admin_auth` is not an exposed schema; apply on staging.
2. Seed operator rows on staging (values from Alvin); later on prod with his yes.
3. Set `ADMIN_AUTH_DATABASE_URL` and `BETTER_AUTH_SECRETS` on Vercel staging Desk (prod later, with Alvin's yes).
4. Own or review slice 3 (auth client change in `lib/admin-auth.ts`); review slice 4.
5. pg_cron cleanup job for expired sessions, verifications and old grants.
6. Separately, as already planned: remove the legacy HMAC cookie (P1), `admin_operators` roles if they outgrow the `user.role` column, `admin_audit_feed` view.

**Desk Engineer**
1. Sign off the charter amendment and `OPS.md` (slice 0).
2. Review the `ops-` additions to `tailwind.config.ts` and the `size="ops"` variants on `Field`, `DeskSelect`, `Segmented`, `Switch`.
3. Presentation review on slices 2, 5, 7, 8, 9. Nothing in the Desk shell, `DESK_LINKS` or owner routes changes.

**Chief of Skills**
Update `ui-ux-pro-max-scalers` (Admin uses the Ops layer; "no competing MASTER" applies to Desk), `super-admin-product` (new IA and registry), `admin-end-to-end-polish` (polish criteria point to `OPS.md`; add step-up checks).

**Scalers Chief**
Priority and the charter sign-off. Voice and Brain: nothing in step 1.

---

## 9. Questions for Alvin (each with my recommendation)

1. **How long should an Admin sign-in last?** Today it is 14 days. **Recommend 12 hours**, so you sign in once a day. Sessions also become revocable.
2. **How often should it ask for a code?** **Recommend:** one code covers 15 minutes of routine money work (grant minutes, package changes, pool assign/release, payments up to KES 20,000); a fresh code every time for prod switches, buying or releasing a SautiKit number, payments over KES 20,000 and security changes.
3. **Should the authenticator also be required at sign-in, not only for sensitive actions?** **Recommend yes, but after step 1**, once step-up has run cleanly for two weeks. The access code alone is one factor, and `ADMIN_ACCESS_CODE` can be shared.
4. **Who are the operators?** **Recommend just you as `owner` for now.** Add others as `viewer` (read-only) until roles have a screen. I need each operator's username and real email for the seed.
5. **Which inbox gets the backup codes?** **Recommend your personal email that has its own 2FA**, not the shared ops list, because whoever reads that inbox can approve actions.
6. **Same rules on staging?** **Recommend yes.** Staging money is fake, but it is where the flow gets tested, and the authenticator entry and emails are clearly labelled staging.
7. **Trying v2 on prod.** **Recommend `ADMIN_V2=alvin` on prod once slice 9 is on staging and you have clicked through it**, so you use the new shell on real data while the old Admin stays the default.
8. **Money and number writes on phone.** **Decided: writes allowed on phone, same step-up rules** (per Scalers Chief relaying Alvin, 22 Oct 16:55 EAT).
9. **Approve the Ops design layer for `/admin` only** (13px body, 28/36/44 rows, own table and chart kit, same brand colours, font and light/dark). **Recommend yes**; Desk Engineer and Scalers Chief sign the charter change in slice 0.

---

## Sources

Repo (read-only, `origin/main` @ `eba04c72`): `dashboard/src/lib/{admin-auth,admin-auth-plugin,adminOperators,adminGuard,adminGate,auth,adminLinks,adminAudit,adminActor,opsMail,deskFeatureFlags}.ts`; `dashboard/src/app/api/admin/**`, `app/api/did-pool/route.ts`; `dashboard/src/app/admin/(console)/layout.tsx`; `dashboard/src/app/globals.css`, `dashboard/tailwind.config.ts`; `packages/email/src/{env,catalog}.ts`, `packages/email/README.md`; `docs/explanation/frontend/FRONTEND_2_0_CHARTER.md`; `docs/reference/design-system/{MASTER,pages/admin}.md`; `docs/supabase/{README,MIGRATION_LEDGER}.md`; `.github/workflows/ci.yml`; root `package.json`.
Better Auth 1.7.6 installed source: `plugins/two-factor/{index,schema,constant,verify-two-factor}.mjs`, `totp/index.mjs`, `otp/index.mjs`, `utils/password.mjs`, `@better-auth/core/dist/db/get-tables.mjs`, `context/secret-utils.mjs`.
Briefs: `admin-rebuild-research.md`, `email-inventory.md`, `balance-alert-2026-10-21.md`.
External: [Better Auth 2FA](https://www.better-auth.com/docs/plugins/2fa) · [GitHub sudo mode](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode) · [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) · [OWASP MFA cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) · [Vercel Geist typography](https://vercel.com/geist/typography) · [Linear: a calmer interface](https://linear.app/now/behind-the-latest-design-refresh) · [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) · [Stripe Apps style tokens](https://docs.stripe.com/stripe-apps/style) · [Stripe chart layout](https://docs.stripe.com/stripe-apps/patterns/chart-layout) · [Retool table customization](https://docs.retool.com/apps/guides/data/table/customization) · npm registry (`@tanstack/react-table`, `recharts`, `@tanstack/react-virtual`, `pg`, `better-auth`), 22 Oct 2026.

Not verified: that `admin_auth` would be absent from the prod project's Exposed schemas (Platform checks in slice 1); Supavisor behaviour with `alter role … set search_path` on the prod pooler (checked on staging in slice 3); exact TanStack Table v9 API (slice 7).

---

## Known issues for when unparked (Platform, 22 Oct 2026)

- **Secret steps need box access first.** Setting `ADMIN_AUTH_DATABASE_URL` and `BETTER_AUTH_SECRETS` on Vercel staging needs a staging DB URL and a Vercel token on the box. Secrets go in only through CLI stdin pipes or masked cards, never through tool arguments. (Per Platform notes; unverified in repo.)
- **`admin_auth_app` would inherit PUBLIC execute.** PostgreSQL grants EXECUTE to PUBLIC on new functions by default. Read-only check, 22 Oct 2026: 101 functions in `public` on staging (`sgcdncjxauhsbunobmob`) are executable by PUBLIC, 15 of them SECURITY DEFINER; 103 on prod (15 SECURITY DEFINER). The role needs `revoke execute ... from public` on those, or a role design that cannot reach `public`, before it is used.
- **Better Auth 1.7.6 `twoFactor.verified` defaults to `true`** (`better-auth/dist/plugins/two-factor/schema.mjs`: `verified: { type: "boolean", required: false, defaultValue: true }`). The `admin_auth.two_factor` table must not default `verified` to true at the DB level, or an unfinished enrolment reads as verified.
- **`rateLimit` has no `id` in Better Auth core** (`@better-auth/core/dist/db/get-tables.mjs`: fields `key` (unique), `count`, `lastRequest` only). The `admin_auth.rate_limit` DDL should key on `key`, or add an `id` that Better Auth will not write.
- Nothing is applied: no `admin_auth` schema exists on staging or prod (read-only check, 22 Oct 2026).
