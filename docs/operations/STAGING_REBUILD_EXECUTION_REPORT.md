# Staging rebuild execution report — Phase 3E Step 2

**Date:** 2026-08-15  
**Target:** `scalers-staging` (`sgcdncjxauhsbunobmob`) — **ONLY**  
**Production:** `ALCR` (`fjxcdccgyhnvnnlnovcl`) — **NOT MODIFIED**  
**Path:** Manual reconstruction per `MIGRATION_LEDGER.md` + `README.md` (no CLI migration replay)

---

## Safety confirmation

| Check | Result |
|---|---|
| All SQL applied to `sgcdncjxauhsbunobmob` | **FACT** |
| Production `fjxcdccgyhnvnnlnovcl` modified | **NO** |
| Production CLI migrations replayed | **NO** |

---

## Step 2A — Apply manifest (executed)

| Order | Artifact | Purpose | Dependencies |
|---|---|---|---|
| 0a | `foundation_bootstrap.sql` §1–4 | Foundation tables + comments | `auth.users`, `uuid-ossp` |
| 1 | `multi_tenant_onboarding.sql` | `tenant_members`, signup trigger, `current_user_tenant_ids` v1 | Foundation tables, `pgcrypto` |
| 2 | `owner_rls.sql` | Canonical RLS helper + member policies | Tier 1 |
| 0b | `foundation_bootstrap.sql` §5–7 | Foundation grants + wallet trigger | `current_user_tenant_ids()` |
| 3–10 | Tier 2–3 profile/knowledge scripts | Tenant profile columns (mostly no-op) | Tier 1 |
| 11–13 | `alert_email`, `notify_channels`, TTS/pronunciation/soniox | Notify + voice columns | Tier 2 |
| 14–16 | `lead_status`, archive, `call_resolution` | Owner CRM on `calls` | `owner_rls` |
| 17–18 | `did_number_pool`, `super_admin_ops` | DID pool + admin RPCs | Tenants |
| 19–23 | Wallet chain (metering → on-demand) | Ledger, RPCs, beta security | `owner_rls` |
| 24 | `agent_tools.sql` | Tool toggles + grant | After wallet grants |
| 25–27 | BI scripts + `appointments.sql` | CRM, catalog, appointments | Operating model → contacts |
| 28 | `fix_p0_rls_remove_legacy_allow_all.sql` | Drop legacy allow-all (no-op greenfield) | Member policies |
| 29 | Storage bucket `call-recordings` | Recording uploads | Manual SQL insert |
| 30 | Staging fix: `notify_channels` UPDATE grant | Desk persistence test (not production bootstrap) | Post-reconstruction |

**Skipped:** `escalation_enabled.sql` (legacy stub), `schema.sql` (reference only)

**Duplicate overwrite lineage (documented, not fixed):**

- `handle_new_user_tenant()` — `voice_languages.sql` then **`did_number_pool.sql` wins**
- `current_user_tenant_ids()` — `multi_tenant_onboarding.sql` then **`owner_rls.sql` wins**
- `tenants_protect_wallet_columns()` — foundation §7 then wallet scripts; **`wallet_on_demand_alerts.sql` wins**

---

## Step 2B — Extensions

| Extension | Staging pre-install | Action |
|---|---|---|
| `uuid-ossp` | 1.1 | Satisfied — no recreate |
| `pgcrypto` | 1.3 | Satisfied — no recreate |

---

## Step 2C — Foundation introspection vs bootstrap

| Check | Expected (bootstrap) | Staging | Status |
|---|---|---|---|
| `tenants` columns | 49 | 49 | **PASS** |
| `calls` columns | 15 | 15 | **PASS** |
| `transcripts` columns | 6 | 6 | **PASS** |
| RLS enabled (foundation tables) | Yes | Yes | **PASS** |
| Member policies (5 on foundation) | 5 named policies | 5 | **PASS** |
| Legacy allow-all policy | Absent | Absent | **PASS** |
| PK / UNIQUE / CHECK constraints | Per bootstrap | Match | **PASS** |
| Secondary indexes on foundation | Not in production bootstrap | Only PK/UNIQUE on foundation tables | **PASS** (parity) |
| `notify_channels` UPDATE grant (production state) | Absent | Absent before staging fix | **PASS** (reproduced) |

---

## Step 2D–2E — Script execution results

All 33 manual scripts applied successfully to staging.

**OBSERVED:** `appointments.sql` first attempt failed with `relation "public.contacts" does not exist` when scripts were applied in parallel. Sequential retry succeeded. **Operator note:** apply scripts strictly sequentially.

### Public tables created (11)

`appointments`, `calls`, `contacts`, `ops_audit_log`, `platform_soniox_voices`, `sautikit_did_pool`, `service_requests`, `tenant_members`, `tenants`, `transcripts`, `wallet_ledger`

---

## Step 2F — Function / trigger final state

| Function | Expected source (README order) | Final staging definition | Status |
|---|---|---|---|
| `handle_new_user_tenant()` | `did_number_pool.sql` (overwrites `voice_languages`) | DID-pool version: `assign_did_from_pool`, 1-arg `default_tenant_llm_prompt`, no explicit `voice_languages` INSERT | **PASS** (lineage) |
| `current_user_tenant_ids()` | `owner_rls.sql` | Security definer; `auth.uid()` membership lookup | **PASS** |
| `tenants_protect_wallet_columns()` | `wallet_on_demand_alerts.sql` | Includes on-demand + alert timestamp columns | **PASS** |
| `charge_call_to_wallet()` | `wallet_on_demand_alerts.sql` | Present | **PASS** |
| `adjust_tenant_wallet()` | `wallet_security_beta.sql` | 2 overloads present | **PASS** |
| `assign_did_from_pool()` | `did_number_pool.sql` | Present | **PASS** |
| `claim_wallet_balance_alerts()` | `wallet_on_demand_alerts.sql` | Present | **PASS** |
| `set_tenant_on_demand_usage()` | `wallet_on_demand_alerts.sql` | Present | **PASS** |

### Triggers

| Trigger | Table | Status |
|---|---|---|
| `on_auth_user_created_provision_tenant` | `auth.users` | **PASS** |
| `tenants_protect_wallet_columns` | `tenants` | **PASS** |
| `wallet_ledger_no_update` / `no_delete` | `wallet_ledger` | **PASS** |

**INFERENCE:** New signups get `voice_languages` from column default (`{en,sw,sheng}`) even though signup trigger omits the column (did-pool version).

---

## Step 2G — Storage

| Property | Staging value |
|---|---|
| Bucket name | `call-recordings` |
| Public | `false` (private) |
| File size limit | `null` |
| MIME restrictions | `null` |
| Storage policies | **NONE** (empty `pg_policies` for `storage` schema) |

**Application requirement:** `src/db.js` uploads via **service_role** (`uploadRecordingBuffer` with upsert).

**INFERENCE:** Service role bypasses Storage RLS; bucket creation alone is sufficient for voice smoke tests.

**UNKNOWN:** Whether production has storage policies not reproduced in Git.

---

## Step 2H — `notify_channels` grant test

| State | `has_column_privilege(authenticated, tenants, notify_channels, UPDATE)` |
|---|---|
| After reconstruction (production parity) | `false` |
| After staging-only fix | `true` |

**FACT:** Reconstruction reproduced the production grant gap.

**PROPOSED FIX (staging-tested, not production):**

```sql
grant update (notify_channels) on public.tenants to authenticated;
```

---

## Seed observations

| Data | Count | Source |
|---|---|---|
| `platform_soniox_voices` | 1 | `soniox_voice_id.sql` INSERT |
| `sautikit_did_pool` | 1 | `did_number_pool.sql` backfill (no available DIDs seeded yet) |

**Gap:** No `available` DID rows for signup auto-assign smoke. Manual seed still required.

---

## Reproducibility verdict (Step 2)

| Area | Status |
|---|---|
| Foundation schema | **PASS** |
| Extensions | **PASS** |
| RLS | **PASS** |
| Grants (production parity) | **PASS** |
| Feature tables | **PASS** |
| Functions / triggers | **PASS** (with documented overwrites) |
| Storage bucket | **PASS** (policies UNKNOWN) |
| Production grant gap reproduced | **PASS** |
| Application smoke (Step 3) | **PENDING** |

**Overall Step 2:** **YELLOW → PASS for database reconstruction** — manual path reproduces required schema. Application/env validation remains for Step 3.
