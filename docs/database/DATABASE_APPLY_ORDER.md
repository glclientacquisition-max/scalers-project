# Database apply order

**Status:** Canonical sequence (Phase 3F, 2026-08-15)  
**Validated on:** Staging `sgcdncjxauhsbunobmob` (Phase 3E)  
**Supersedes:** README order alone where split-bootstrap is required

This document is the **executable** apply sequence for greenfield / full staging rebuild. For tier summaries, see [`../supabase/README.md`](../supabase/README.md).

---

## Critical rules

1. Apply **strictly sequentially**. Parallel apply caused `appointments.sql` failure (missing `contacts`) in Phase 3E.
2. **Split** `foundation_bootstrap.sql` — §5–7 require `current_user_tenant_ids()` from `owner_rls.sql`.
3. **Skip** `escalation_enabled.sql` (legacy stub) and `schema.sql` (reference only).
4. **Do not** apply `foundation_bootstrap.sql` to ALCR production (tables exist).

---

## Ordered sequence

### 0. Extensions

| Step | Action | Depends on | Notes |
| --- | --- | --- | --- |
| 0.1 | `create extension if not exists "uuid-ossp"` | Supabase base image | In bootstrap §1; usually pre-installed |
| 0.2 | `pgcrypto` | Supabase base image | Required by `multi_tenant_onboarding.sql`; pre-installed on staging |

**Rationale:** PK defaults use `uuid_generate_v4()`. Onboarding may use `gen_random_uuid()` via pgcrypto.

---

### 1. Foundation tables (bootstrap part A)

| Step | File | Section | Creates |
| --- | --- | --- | --- |
| 1 | `foundation_bootstrap.sql` | §1–4 | `tenants`, `calls`, `transcripts` (full column set) |

**Blocker if skipped:** All downstream scripts fail on missing tables.

**Known issue:** §1–4 creates tables with all 49 tenant columns. Later tier 2–4 scripts mostly no-op (`ADD COLUMN IF NOT EXISTS`).

---

### 2. Core helper functions + tenant/auth provisioning

| Step | File | Depends on | Creates / overwrites |
| --- | --- | --- | --- |
| 2 | `multi_tenant_onboarding.sql` | §1–4 tables, `auth.users` | `tenant_members`, signup trigger v1, `default_tenant_llm_prompt(text)` v1, `current_user_tenant_ids()` v1 |
| 3 | `owner_rls.sql` | step 2 | **`current_user_tenant_ids()` canonical**; member RLS on foundation + `tenant_members` |

**Overwrite:** `current_user_tenant_ids()` — `owner_rls.sql` wins over `multi_tenant_onboarding.sql`.

---

### 3. Foundation RLS, grants, wallet trigger (bootstrap part B)

| Step | File | Section | Depends on |
| --- | --- | --- | --- |
| 4 | `foundation_bootstrap.sql` | §5–7 | `owner_rls.sql` (`current_user_tenant_ids`) |

**Creates:** RLS policies, column-scoped grants, `tenants_protect_wallet_columns()` v1.

**Unsafe if early:** §5 fails without `current_user_tenant_ids()`.

---

### 4. Tenant profile + languages

| Step | File | Depends on |
| --- | --- | --- |
| 5 | `tenant_business_profile.sql` | tier 1 |
| 6 | `voice_languages.sql` | tier 1; **drops 1-arg `default_tenant_llm_prompt`** |

**Overwrite:** `handle_new_user_tenant()` v2 (languages); `default_tenant_llm_prompt(text, text[])`.

---

### 5. Knowledge acquisition

| Step | File | Depends on |
| --- | --- | --- |
| 7 | `knowledge_acquisition_phase1.sql` | `tenant_business_profile.sql` |
| 8 | `employee_training.sql` | `tenant_business_profile.sql` |
| 9 | `hours_schedule.sql` | `knowledge_acquisition_phase1.sql` |
| 10 | `services_catalog.sql` | `knowledge_acquisition_phase1.sql` |
| 11 | `after_hours_mode.sql` | `hours_schedule.sql` |
| 12 | `daily_bulletin.sql` | `services_catalog.sql`, `after_hours_mode.sql` |

---

### 6. Small additive tenant columns

| Step | File | Depends on |
| --- | --- | --- |
| 13 | `alert_email.sql` | `tenants` |
| 14 | `notify_channels.sql` | `alert_email.sql` |
| 15 | `tts_lexicon.sql` | `tenants`; grant may be overwritten later |
| 16 | `pronunciation_gemini_scan.sql` | `tts_lexicon.sql` |
| 17 | `soniox_voice_id.sql` | `tenants`, `platform_soniox_voices` table |

---

### 7. Owner CRM (calls)

| Step | File | Depends on |
| --- | --- | --- |
| 18 | `lead_status.sql` | `owner_rls.sql`; **drops/recreates `calls_update_member` policy** |
| 19 | `lead_status_archive.sql` | `lead_status.sql` |
| 20 | `call_resolution.sql` | `lead_status.sql` |

---

### 8. DID pool + Super Admin

| Step | File | Depends on | Overwrites |
| --- | --- | --- | --- |
| 21 | `did_number_pool.sql` | `multi_tenant_onboarding.sql` | **`handle_new_user_tenant()` final**; calls 2-arg prompt |
| 22 | `super_admin_ops.sql` | `did_number_pool.sql` | Destructive RPCs (`remove_business_and_release_did`) |

**Signup path:** Final trigger is `did_number_pool.sql` version (#158 fix uses 2-arg prompt + `voice_languages` column default).

---

### 9. Billing / wallet (strict order)

| Step | File | Depends on | Overwrites |
| --- | --- | --- | --- |
| 23 | `wallet_metering.sql` | `owner_rls.sql` | Legacy dual-wallet columns |
| 24 | `one_wallet_billing.sql` | `wallet_metering.sql` | Ledger table, charge RPCs |
| 25 | `wallet_security_beta.sql` | `one_wallet_billing.sql` | **`tenants_protect_wallet_columns()` v2**; column grants; RPC locks |
| 26 | `fix_charge_call_wallet_ambiguous.sql` | `one_wallet_billing.sql` | RPC body fix |
| 27 | `wallet_soft_spend_limit.sql` | `wallet_security_beta.sql` | **`tenants_protect_wallet_columns()` v3** |
| 28 | `wallet_on_demand_alerts.sql` | wallet security chain | **`tenants_protect_wallet_columns()` final**; alert RPCs |

**Blocker:** Wrong wallet order breaks RPC signatures and grants.

---

### 10. Agent tools

| Step | File | Depends on |
| --- | --- | --- |
| 29 | `agent_tools.sql` | **After** `wallet_security_beta.sql` (column grant chain) |

---

### 11. Business intelligence / CRM

| Step | File | Depends on |
| --- | --- | --- |
| 30 | `business_operating_model.sql` | knowledge era / `agent_tools.sql` |
| 31 | `contacts_and_requests.sql` | `business_operating_model.sql`, `owner_rls.sql` |
| 32 | `product_catalog_and_social.sql` | `business_operating_model.sql` |
| 33 | `appointments.sql` | **`contacts_and_requests.sql`** (FK to contacts) |

**Blocker:** `appointments.sql` before `contacts_and_requests.sql` → `relation "public.contacts" does not exist`.

---

### 12. Security repairs

| Step | File | When |
| --- | --- | --- |
| 34 | `fix_p0_rls_remove_legacy_allow_all.sql` | Greenfield: no-op. Legacy projects: required |

---

### 13. Storage (not in feature SQL)

| Step | Action | Notes |
| --- | --- | --- |
| 35 | Create bucket `call-recordings` (private) | Manual SQL or Dashboard; **no Git policy script** |

**UNKNOWN:** Production storage RLS policies.

---

### 14. Seed fixtures (operational)

| Step | Action | Required for |
| --- | --- | --- |
| 36 | Insert `available` rows in `sautikit_did_pool` | Signup auto-assign smoke |
| 37 | Seed `platform_soniox_voices` if needed | Voice picker (1 row from `soniox_voice_id.sql`) |

---

### 15. Validation

| Step | Command / query | Pass criteria |
| --- | --- | --- |
| 38 | Column counts: tenants=49, calls=15, transcripts=6 | Match bootstrap |
| 39 | `npm run smoke:db` | All voice DB paths |
| 40 | Auth signup with onboarding metadata | Tenant + `tenant_members` row |
| 41 | Policy count on foundation tables | 5 member policies; no legacy allow-all |

---

## Known function/trigger overwrites

| Function | Versions | Final winner | Risk if order wrong |
| --- | --- | --- | --- |
| `current_user_tenant_ids()` | onboarding → owner_rls | `owner_rls.sql` | Wrong RLS scope |
| `default_tenant_llm_prompt()` | 1-arg → 2-arg | `voice_languages.sql` (after DROP 1-arg) | Signup `42725` ambiguity |
| `handle_new_user_tenant()` | onboarding → voice_languages → did_pool | `did_number_pool.sql` | Signup/DID behavior |
| `tenants_protect_wallet_columns()` | bootstrap → wallet_security → soft_spend → on_demand | `wallet_on_demand_alerts.sql` | Wallet column exposure |

---

## Known unsafe / destructive operations

| File | Operation | Scope | Mitigation |
| --- | --- | --- | --- |
| `super_admin_ops.sql` | `DELETE` tenant/calls/transcripts | Super Admin RPC only | `service_role` only |
| `fix_p0_rls_remove_legacy_allow_all.sql` | `DROP POLICY` | Legacy policies | Idempotent |
| `lead_status.sql` | `DROP POLICY calls_update_member` | Recreates with column scope | Expected |
| `owner_rls.sql` | `DROP POLICY` on member tables | Recreates stricter policies | Expected |
| `voice_languages.sql` | `DROP FUNCTION default_tenant_llm_prompt(text)` | Removes overload | Required for signup |

**No script** in the standard path drops foundation tables.

---

## Production gap: `notify_channels` grant

| Item | Detail |
| --- | --- |
| Issue | `foundation_bootstrap.sql` §6 previously omitted `UPDATE (notify_channels)` |
| Production | **APPLIED** 2026-08-16 (`LEDGER-PROD-NOTIFY-GRANT`, CLI `20260816180900`) |
| Staging | Present since Phase 3E; Git path is now `notify_channels.sql` |
| Report | [`PHASE_3H_A3_APPLY_REPORT.md`](../operations/PHASE_3H_A3_APPLY_REPORT.md) |

```sql
grant update (notify_channels) on public.tenants to authenticated;
```

---

## Blockers summary

| Blocker | Resolution |
| --- | --- |
| Bootstrap §5–7 before `owner_rls.sql` | Split apply (steps 1–4) |
| `appointments` before `contacts` | Enforce step 33 after 31 |
| Wallet scripts out of order | Follow steps 23–28 strictly |
| Signup `42725` on fresh apply | Ensure #158 fix in `voice_languages.sql` + `did_number_pool.sql` |
| No available DIDs | Manual seed step 36 |
| Storage policies missing | Service role upload works; owner signed URLs **UNKNOWN** |

---

## Can a fresh Supabase project be built from Git?

| Question | Answer |
| --- | --- |
| Schema reproducible? | **YES** — proven on staging (Phase 3E) |
| Fully automated? | **NO** — manual SQL Editor steps + storage bucket + seeds |
| CLI migration replay required? | **NO** |
| Matches production exactly? | **PARTIAL** — grant gaps and storage policies may differ |

---

## Related documents

- [`DATABASE_EVOLUTION.md`](./DATABASE_EVOLUTION.md)
- [`../supabase/README.md`](../supabase/README.md)
- [`../operations/STAGING_REBUILD_EXECUTION_REPORT.md`](../operations/STAGING_REBUILD_EXECUTION_REPORT.md)
