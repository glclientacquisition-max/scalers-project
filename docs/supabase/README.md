# Supabase SQL apply order

Canonical index for every file in `docs/supabase/`. Prefer **additive** scripts; re-runs should be safe (`if not exists`, `drop … if exists`, idempotent backfills).

Apply in the **Supabase SQL Editor** (or `psql`) against the target project. Voice engine + Super Admin + signup provisioner use **service_role** (bypasses RLS). Owners use Auth JWT + RLS.

For product notes on wallet/DID, see also:

- [`docs/ONE_WALLET_BILLING.md`](../ONE_WALLET_BILLING.md)
- [`docs/BETA_WALLET_PROGRAM.md`](../BETA_WALLET_PROGRAM.md)
- [`docs/PRODUCTION_DID_POOL.md`](../PRODUCTION_DID_POOL.md)

---

## Reference only (do not “apply” as a migration)

| File | Role |
| --- | --- |
| [`schema.sql`](./schema.sql) | Introspected live shape notes for `tenants` / `calls` / `transcripts` / related tables. Base tables are assumed to already exist on the project. |

---

## Fresh / catch-up apply order

Use this order on a new environment or when catching up an older project. Skip files already applied. Within a tier, numbered steps are ordered; same-tier siblings can run in the listed sequence.

### 1. Membership + RLS

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 1 | [`multi_tenant_onboarding.sql`](./multi_tenant_onboarding.sql) | Live `tenants` (+ signup meta) | `tenant_members`, `owner_user_id`, signup provision trigger |
| 2 | [`owner_rls.sql`](./owner_rls.sql) | `multi_tenant_onboarding.sql` | `current_user_tenant_ids()`, owner policies on members/tenants/calls/transcripts |

### 2. Tenant profile + languages

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 3 | [`tenant_business_profile.sql`](./tenant_business_profile.sql) | `multi_tenant_onboarding.sql` | `business_hours`, `services_offered`, `agent_tone` |
| 4 | [`voice_languages.sql`](./voice_languages.sql) | `multi_tenant_onboarding.sql` | Auto `{en,sw,sheng}` + default prompt helper |

### 3. Knowledge acquisition columns

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 5 | [`knowledge_acquisition_phase1.sql`](./knowledge_acquisition_phase1.sql) | `tenant_business_profile.sql` | `agent_name`, `team_directory`, `faqs` (+ tone) |
| 6 | [`employee_training.sql`](./employee_training.sql) | `tenant_business_profile.sql` | `unknown_answer_fallback` |
| 7 | [`hours_schedule.sql`](./hours_schedule.sql) | `knowledge_acquisition_phase1.sql` | Structured weekly hours (live open/closed) |
| 8 | [`services_catalog.sql`](./services_catalog.sql) | `knowledge_acquisition_phase1.sql` | Live services catalog JSON |
| 9 | [`after_hours_mode.sql`](./after_hours_mode.sql) | `hours_schedule.sql` | `serve` \| `message` |
| 10 | [`daily_bulletin.sql`](./daily_bulletin.sql) | `services_catalog.sql`, `after_hours_mode.sql` | Temporary bulletin items for CONTEXT HEADER |

### 4. Small additive tenant columns

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 11 | [`alert_email.sql`](./alert_email.sql) | `tenants` | Email fallback when WhatsApp unavailable |
| 12 | [`tts_lexicon.sql`](./tts_lexicon.sql) | `tenants` | Per-tenant TTS pronunciation overrides (Train pronunciation coach) |

### 5. Owner CRM

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 13 | [`lead_status.sql`](./lead_status.sql) | `owner_rls.sql` | `calls.lead_status` + column-scoped owner UPDATE |
| 13b | [`lead_status_archive.sql`](./lead_status_archive.sql) | `lead_status.sql` | Adds `archived` status (Archive action; Done stays `resolved`) |
| 13c | [`call_resolution.sql`](./call_resolution.sql) | `lead_status.sql` | `calls.resolution` + `primary_intent` + `resolution_note` (AI assist outcome; owner may correct) |

### 6. DID pool + Super Admin helpers

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 14 | [`did_number_pool.sql`](./did_number_pool.sql) | `tenants` / onboarding | Pool table + `assign_did_from_pool`. Seed `available` rows after apply (see PRODUCTION_DID_POOL) |
| 15 | [`super_admin_ops.sql`](./super_admin_ops.sql) | `did_number_pool.sql` | Release DID / remove business helpers |

### 7. Wallet (Ops) — strict sequence

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 16 | [`wallet_metering.sql`](./wallet_metering.sql) | `owner_rls.sql` (and profile era) | Dual-wallet columns + legacy `adjust_tenant_wallet` |
| 17 | [`one_wallet_billing.sql`](./one_wallet_billing.sql) | `wallet_metering.sql` | Single KES wallet, ledger, charge/line RPCs — see ONE_WALLET_BILLING |
| 18 | [`wallet_security_beta.sql`](./wallet_security_beta.sql) | `one_wallet_billing.sql` | Beta defaults, RPC locks, column grants, `ops_audit_log` |
| 18b | [`fix_charge_call_wallet_ambiguous.sql`](./fix_charge_call_wallet_ambiguous.sql) | `one_wallet_billing.sql` | Qualify `tenants.wallet_balance_kes` in `charge_call_to_wallet` early returns (OUT-param shadowing). Safe to re-run. |
| 18c | [`wallet_soft_spend_limit.sql`](./wallet_soft_spend_limit.sql) | `wallet_security_beta.sql` | Optional owner monthly soft budget columns (legacy UI removed; columns harmless) |
| 18d | [`wallet_on_demand_alerts.sql`](./wallet_on_demand_alerts.sql) | `wallet_security_beta.sql` (prefer after 18c) | Automatic low/empty prepaid live alerts + owner on-demand opt-in |

### 8. Tool toggles (after wallet column grants)

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 19 | [`agent_tools.sql`](./agent_tools.sql) | `tenants`; prefer **after** `wallet_security_beta.sql` | `agent_tools` jsonb + `grant update (agent_tools)` for authenticated |

### 9. Business intelligence / retail

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 20 | [`business_operating_model.sql`](./business_operating_model.sql) | `services_catalog.sql` era | `vertical`, `handoff_mode`, `business_locations`, `business_policies` |
| 21 | [`contacts_and_requests.sql`](./contacts_and_requests.sql) | `business_operating_model.sql` | `contacts` + `service_requests` + RLS |
| 22 | [`product_catalog_and_social.sql`](./product_catalog_and_social.sql) | `business_operating_model.sql` | `product_catalog` + `social_handles` (products separate from services) |
| 23 | [`appointments.sql`](./appointments.sql) | `contacts_and_requests.sql` | Home-services visit bookings (`requested\|confirmed\|cancelled\|done`) + RLS |

---

## Legacy / do not apply

| File | Status |
| --- | --- |
| [`escalation_enabled.sql`](./escalation_enabled.sql) | **Legacy stub.** App does not read this Telegram-era toggle. Safe to leave any existing column; do not re-wire product UI to it. |

---

## Invariants (Platform)

1. Scripts are additive and ordered; document new files here **and** in the SQL header (`-- Run after …`).
2. Service role keys stay server-only — never `NEXT_PUBLIC_*`.
3. Tenant isolation via `tenant_members`; no cross-tenant owner policies.
4. Keep the voice DB surface in `src/db.js` stable (`upsertCall`, `chargeCallToWallet`, …).
5. New wallet/DID RPC shapes: Ops specifies behavior; Platform lands SQL + `src/db.js` contracts.

---

## How to add a new migration

1. Add `docs/supabase/<name>.sql` with ASCII-only SQL and a header: purpose + **exact predecessor** file(s).
2. Insert it into the table above at the correct dependency step (do not renumber historical production applies — append with a clear “after X” note).
3. If Ops/Brain/Desk consume the change, link from their lane doc or product doc.
4. Prefer expanding columns/RPCs over breaking `src/db.js` call sites.
