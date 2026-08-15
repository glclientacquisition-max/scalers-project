# Migration ledger

**Status:** Authoritative index (hardened Phase 3F, 2026-08-15)  
**Production:** ALCR (`fjxcdccgyhnvnnlnovcl`)  
**Staging:** `scalers-staging` (`sgcdncjxauhsbunobmob`)

Scalers uses a **dual migration model**:

1. **Foundation tables** — predate documented migration system; bootstrap via [`foundation_bootstrap.sql`](./foundation_bootstrap.sql) (production-introspected, historically unverified).
2. **Manual SQL scripts** — `docs/supabase/*.sql` applied via SQL Editor (primary governance model).
3. **Supabase CLI migrations** — partial adoption from 2026-08-07; recorded in `supabase_migrations.schema_migrations` on production (24 rows).

---

## Foundation tables

| Table | Columns | Bootstrap source | Historical CREATE provenance |
| --- | --- | --- | --- |
| `public.tenants` | 49 | `foundation_bootstrap.sql` | **UNKNOWN** |
| `public.calls` | 15 | `foundation_bootstrap.sql` | **UNKNOWN** |
| `public.transcripts` | 6 | `foundation_bootstrap.sql` | **UNKNOWN** |

**Do not use** commit `9153a09` CREATE TABLE as foundation source.

---

## Production CLI migration ledger (`supabase_migrations.schema_migrations`)

Recorded on ALCR as of 2026-08-14 (24 rows). None create foundation tables.

| Version | Name | Touches foundation |
| --- | --- | --- |
| 20260807225947 | daily_bulletin | tenants.daily_bulletin |
| 20260808005039 | escalation_enabled | tenants.escalation_enabled |
| 20260808053931 | alert_email | tenants.alert_email |
| 20260808080322 | one_wallet_billing | tenants wallet columns |
| 20260808103634 | wallet_security_beta_part1 | tenants beta + trigger |
| 20260808103644 | wallet_security_beta_part2_rpcs | RPCs (touch tenants) |
| 20260808103657 | wallet_security_beta_part3_grants | tenants/calls grants |
| 20260808112824 | agent_tools | tenants.agent_tools |
| 20260811044451 | business_operating_model | tenants vertical/handoff/locations/policies |
| 20260811044502 | contacts_and_requests | FK to calls, tenants |
| 20260811061942 | fix_charge_call_wallet_ambiguous | RPC |
| 20260811072236 | lead_status_archive | calls.lead_status CHECK |
| 20260811072353 | wallet_soft_spend_limit | tenants soft spend |
| 20260811073319 | wallet_on_demand_alerts | tenants on-demand columns |
| 20260811073341 | wallet_on_demand_alerts_fns | RPC + trigger patch |
| 20260811073356 | wallet_claim_alerts_and_ondemand_rpc | RPC |
| 20260811102735 | add_tenants_tts_lexicon | tenants.tts_lexicon |
| 20260811122648 | grant_owner_update_tts_lexicon | grant |
| 20260811142321 | product_catalog_and_social | tenants product/social |
| 20260812025507 | call_resolution | calls resolution columns |
| 20260812083631 | appointments | FK to calls, tenants |
| 20260812141513 | soniox_voice_catalog | tenants voice columns |
| 20260813073840 | pronunciation_gemini_scan | tenants pronunciation columns |
| 20260813210755 | notify_channels | tenants.notify_channels |

**Not in CLI ledger (applied manually):**

- `multi_tenant_onboarding.sql`, `owner_rls.sql`, tier 2–7 manual scripts predating CLI adoption
- `fix_p0_rls_remove_legacy_allow_all.sql` (P0, 2026-08-14)

---

## Manual script tiers (summary)

Full order: [`README.md`](./README.md).

| Tier | Scope | Foundation dependency |
| --- | --- | --- |
| 0 | `foundation_bootstrap.sql` | Creates tenants, calls, transcripts |
| 1 | Membership + RLS | Requires tenants |
| 2–4 | Tenant profile columns | `ALTER TABLE tenants ADD COLUMN` (no-op if bootstrapped) |
| 5 | Owner CRM | `ALTER TABLE calls ADD COLUMN` |
| 6–9 | DID, wallet, BI, appointments | FK references to tenants/calls |

---

## Column lineage — foundation-era columns

Columns present before CLI migration adoption. Earliest Git evidence is comment-only introspection (`34d0d54`, Aug 6 2026), not CREATE TABLE.

### tenants (foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` schema.sql comment | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| business_name | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sautikit_virtual_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| whatsapp_notification_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| llm_system_prompt | text | `34d0d54` | FOUNDATION_UNKNOWN |
| is_active | boolean | `34d0d54` | FOUNDATION_UNKNOWN |

### calls (foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| tenant_id | uuid FK CASCADE | `34d0d54` | FOUNDATION_UNKNOWN |
| caller_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sautikit_call_sid | text UNIQUE | `34d0d54` | FOUNDATION_UNKNOWN |
| status | text | `34d0d54` | FOUNDATION_UNKNOWN |
| duration_seconds | integer | `34d0d54` | FOUNDATION_UNKNOWN |
| recording_url | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sentiment | text | `34d0d54` | FOUNDATION_UNKNOWN |
| summary | text | `34d0d54` | FOUNDATION_UNKNOWN |

### transcripts (all foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` (utterance model) | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| call_id | uuid FK CASCADE | `34d0d54` | FOUNDATION_UNKNOWN |
| speaker | text | `34d0d54` | FOUNDATION_UNKNOWN |
| text_content | text | `34d0d54` | FOUNDATION_UNKNOWN |
| latency_ms | integer | `34d0d54` | FOUNDATION_UNKNOWN |

Additive columns (post-foundation) are documented per file in [`README.md`](./README.md) and mapped in Phase 3D-4 audit.

---

## Storage

| Bucket | Public | Created (production) | Git SQL |
| --- | --- | --- | --- |
| `call-recordings` | false | 2026-08-06 08:42 UTC | **UNKNOWN** (manual/Dashboard) |

Referenced in `foundation_bootstrap.provenance.md`, `schema.sql`, `DEPLOYMENT.md`.

---

## Security repairs

| File | Applied production | In CLI ledger |
| --- | --- | --- |
| `fix_p0_rls_remove_legacy_allow_all.sql` | YES (2026-08-14) | NO |

Post-P0 member-only RLS is encoded in `foundation_bootstrap.sql`.

---

## Ledger entry template (required for new changes)

Every database change merged to `main` must add a row to the **Change registry** below (or update an existing row). Use **UNKNOWN** when evidence does not exist. Do not fabricate dates.

| Field | Description |
| --- | --- |
| **ID** | `LEDGER-YYYY-MM-DD-<slug>` or script filename |
| **What** | Tables, columns, RPCs, policies, grants affected |
| **Why** | Feature, bugfix, or security repair |
| **Where** | Path under `docs/supabase/` |
| **Introduced commit** | Git SHA on `main` (after merge) |
| **Staging applied** | `YES` / `NO` / `UNKNOWN` |
| **Staging applied date** | ISO date if evidenced; else `UNKNOWN` |
| **Production applied** | `YES` / `NO` / `UNKNOWN` |
| **Production applied date** | ISO date if evidenced; else `UNKNOWN` |
| **In CLI ledger** | `YES` (version) / `NO` / `N/A` |
| **Verification** | Tests, smoke, manual checks performed |

### Process

1. Author SQL in `docs/supabase/<name>.sql` with `-- Run after:` header.
2. Update [`README.md`](./README.md) and [`DATABASE_APPLY_ORDER.md`](../database/DATABASE_APPLY_ORDER.md) if order changes.
3. Add ledger row before or with merge PR.
4. After staging apply: set `staging_applied = YES`, date, verification notes.
5. After production apply (human-approved): set `production_applied = YES`, date, executor.

---

## Change registry

### Foundation and governance

| ID | What | Why | Where | Introduced commit | Staging | Production | CLI | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LEDGER-FOUNDATION | Bootstrap `tenants`/`calls`/`transcripts` shape | Phase 3D-5 reproducibility | `foundation_bootstrap.sql` | `c0985f0` | YES (2026-08-15 full rebuild) | N/A (already exists) | N/A | Staging column counts; RLS policy count |
| LEDGER-P0-RLS | Drop legacy allow-all RLS policies | P0 tenant isolation | `fix_p0_rls_remove_legacy_allow_all.sql` | `92af666` (#154) | YES (2026-08-15) | YES (2026-08-14) | NO | Production manual apply; staging greenfield no-op |

### Feature scripts (manual path)

| ID | What | Why | Where | Introduced commit | Staging | Production | CLI | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LEDGER-NOTIFY-CH | `tenants.notify_channels` jsonb | Owner notify prefs | `notify_channels.sql` | `7af0fcb` (#155) | YES (2026-08-15) | YES (inferred pre-3E) | `20260813210755` | Staging rebuild; production CLI row |
| LEDGER-APPOINTMENTS | `appointments` table + RLS | Home-services bookings | `appointments.sql` | `7af0fcb` (#155) | YES (2026-08-15) | YES (inferred pre-3E) | `20260812083631` | Staging insert smoke |
| LEDGER-SIGNUP-FIX | Drop 1-arg prompt; 2-arg canonical | Fix signup `42725` | `voice_languages.sql`, `did_number_pool.sql` | `f61c11f` (#158) | YES (2026-08-15) | UNKNOWN | NO | Staging signup PASS |

### Staging-only / proposed (not in standard Git apply)

| ID | What | Why | Where | Staging | Production | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| LEDGER-STAGING-NOTIFY-GRANT | `GRANT UPDATE (notify_channels)` | Desk persistence test | Ad-hoc SQL (Phase 3E) | YES (2026-08-15) | NO | Reproduces production gap; proposed production fix |
| LEDGER-STAGING-STORAGE | Bucket `call-recordings` | Voice recordings | Manual / Dashboard | YES (2026-08-15) | YES (2026-08-06) | Policies UNKNOWN on both |

### Bulk manual scripts (pre-CLI era)

The following scripts are **INFERRED** applied on production (live schema matches Git intent) but lack per-script apply dates:

`multi_tenant_onboarding.sql`, `owner_rls.sql`, tiers 2–9 per README, wallet chain, `agent_tools.sql`, BI scripts.

| Staging (full rebuild) | Production (per script) |
| --- | --- |
| YES (2026-08-15, Phase 3E) | UNKNOWN (bulk); CLI ledger covers 24 post-adoption changes |

---

## Production ledger backfill (Phase 3G)

**Method:** Evidence from `supabase_migrations.schema_migrations` on ALCR (recorded Phase 3F). **No production SQL executed in Phase 3G.**

CLI version timestamps are **INFERRED** from version string `YYYYMMDDHHMMSS` (UTC). Per-script dates for pre-CLI manual applies remain **UNKNOWN**.

| CLI version | Name | Production applied | Inferred date (UTC) | Git script |
| --- | --- | --- | --- | --- |
| 20260807225947 | daily_bulletin | YES | 2026-08-07 | `daily_bulletin.sql` |
| 20260808005039 | escalation_enabled | YES | 2026-08-08 | `escalation_enabled.sql` (legacy) |
| 20260808053931 | alert_email | YES | 2026-08-08 | `alert_email.sql` |
| 20260808080322 | one_wallet_billing | YES | 2026-08-08 | `one_wallet_billing.sql` |
| 20260808103634 | wallet_security_beta_part1 | YES | 2026-08-08 | `wallet_security_beta.sql` |
| 20260808103644 | wallet_security_beta_part2_rpcs | YES | 2026-08-08 | `wallet_security_beta.sql` |
| 20260808103657 | wallet_security_beta_part3_grants | YES | 2026-08-08 | `wallet_security_beta.sql` |
| 20260808112824 | agent_tools | YES | 2026-08-08 | `agent_tools.sql` |
| 20260811044451 | business_operating_model | YES | 2026-08-11 | `business_operating_model.sql` |
| 20260811044502 | contacts_and_requests | YES | 2026-08-11 | `contacts_and_requests.sql` |
| 20260811061942 | fix_charge_call_wallet_ambiguous | YES | 2026-08-11 | `fix_charge_call_wallet_ambiguous.sql` |
| 20260811072236 | lead_status_archive | YES | 2026-08-11 | `lead_status_archive.sql` |
| 20260811072353 | wallet_soft_spend_limit | YES | 2026-08-11 | `wallet_soft_spend_limit.sql` |
| 20260811073319 | wallet_on_demand_alerts | YES | 2026-08-11 | `wallet_on_demand_alerts.sql` |
| 20260811073341 | wallet_on_demand_alerts_fns | YES | 2026-08-11 | `wallet_on_demand_alerts.sql` |
| 20260811073356 | wallet_claim_alerts_and_ondemand_rpc | YES | 2026-08-11 | `wallet_on_demand_alerts.sql` |
| 20260811102735 | add_tenants_tts_lexicon | YES | 2026-08-11 | `tts_lexicon.sql` |
| 20260811122648 | grant_owner_update_tts_lexicon | YES | 2026-08-11 | `tts_lexicon.sql` |
| 20260811142321 | product_catalog_and_social | YES | 2026-08-11 | `product_catalog_and_social.sql` |
| 20260812025507 | call_resolution | YES | 2026-08-12 | `call_resolution.sql` |
| 20260812083631 | appointments | YES | 2026-08-12 | `appointments.sql` |
| 20260812141513 | soniox_voice_catalog | YES | 2026-08-12 | `soniox_voice_id.sql` |
| 20260813073840 | pronunciation_gemini_scan | YES | 2026-08-13 | `pronunciation_gemini_scan.sql` |
| 20260813210755 | notify_channels | YES | 2026-08-13 | `notify_channels.sql` |

**Manual production applies (evidenced, not in CLI ledger):**

| Script | Production | Date | Evidence |
| --- | --- | --- | --- |
| `fix_p0_rls_remove_legacy_allow_all.sql` | YES | 2026-08-14 | Phase 3F ledger / PR #154 |
| `grant_notify_channels_update.sql` | **NO** | — | Prepared Phase 3G; see `PRODUCTION_CHANGE_NOTIFY_CHANNELS.md` |
| Pre-CLI bulk manual scripts | INFERRED YES | UNKNOWN | Live schema matches Git; no per-script dates |

---

## Answering ledger questions

| Question | Where to look |
| --- | --- |
| What changed? | Change registry **What** column; file header |
| When? | **Staging/Production applied date**; CLI version timestamp |
| Why? | **Why** column; linked PR |
| Where? | **Where** path; `README.md` tier |
| Applied to staging? | **Staging** column |
| Applied to production? | **Production** column; CLI ledger |
| Introducing commit? | **Introduced commit** |
| Verification? | **Verification** column; `STAGING_REBUILD_EXECUTION_REPORT.md` |

---

## Related documents

- [`DATABASE_EVOLUTION.md`](../database/DATABASE_EVOLUTION.md)
- [`DATABASE_APPLY_ORDER.md`](../database/DATABASE_APPLY_ORDER.md)
- [`../operations/STAGING_REBUILD_EXECUTION_REPORT.md`](../operations/STAGING_REBUILD_EXECUTION_REPORT.md)
