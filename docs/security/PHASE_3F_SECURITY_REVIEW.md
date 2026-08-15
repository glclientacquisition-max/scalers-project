# Phase 3F security review

**Date:** 2026-08-15  
**Scope:** Read-only review of repository SQL, auth patterns, and Phase 3E staging evidence  
**Production:** NOT modified  
**Classification:** P0 (critical) → P3 (low)

---

## Methodology

- Reviewed `docs/supabase/*.sql` grants, RLS, `SECURITY DEFINER` functions
- Reviewed `foundation_bootstrap.sql` §5–7 grant snapshot
- Cross-referenced Phase 3E staging report (storage, notify_channels, signup)
- Reviewed `src/db.js` and desk auth patterns (inference from docs/code references)
- No production catalog query in this phase (prior Phase 3D-4 audit used)

Evidence labels: **FACT**, **INFERENCE**, **UNKNOWN**, **PROPOSED**

---

## Executive summary

| Severity | Count | Themes |
| --- | --- | --- |
| P0 | 0 open | Legacy allow-all RLS **remediated** 2026-08-14 |
| P1 | 4 open | Grants, storage, logging, migration visibility |
| P2 | 5 open | Auth model, grant patterns, schema fallback |
| P3 | 3 open | Dev bypasses, operational hygiene |

Tenant isolation via member-scoped RLS is **sound in Git** post-P0 fix. Residual risk is **operational** (unknown production apply state, storage policies, missing column grant).

---

## P0 findings

### SEC-P0-1: Legacy allow-all RLS policies — **REMEDIATED**

| Field | Detail |
| --- | --- |
| **Status** | CLOSED on production 2026-08-14 |
| **Evidence** | `fix_p0_rls_remove_legacy_allow_all.sql`; PR #154 |
| **Verification** | Staging rebuild has no legacy policies (Phase 3E) |

No open P0 findings.

---

## P1 findings

### SEC-P1-1: `notify_channels` missing authenticated UPDATE grant (production)

| Field | Detail |
| --- | --- |
| **What** | Desk owner cannot persist `tenants.notify_channels` via RLS client |
| **Evidence** | **FACT** — `foundation_bootstrap.sql` §6 comment; staging reproduced absent grant |
| **Impact** | Owner notify preferences may not save on production |
| **Staging** | Test grant applied (not in standard Git path) |
| **PROPOSED fix** | `grant update (notify_channels) on public.tenants to authenticated;` + ledger entry |
| **Requires** | Human-approved production SQL |

---

### SEC-P1-2: Storage bucket policies not in Git

| Field | Detail |
| --- | --- |
| **What** | `call-recordings` bucket exists; RLS policies **UNKNOWN** in repository |
| **Evidence** | **FACT** — staging has zero storage policies; production **UNKNOWN** |
| **Impact** | If policies are loose, direct object access risk; voice uses service_role upload (lower risk for engine path) |
| **PROPOSED fix** | Introspect production storage policies (read-only); commit policy SQL if needed |
| **Owner** | Platform |

---

### SEC-P1-3: Verbose request logging (PII / credentials)

| Field | Detail |
| --- | --- |
| **What** | Full HTTP headers and webhook bodies logged |
| **Evidence** | **FACT** — TD-P1-4; `server.js` references |
| **Impact** | Credential/PII leakage in log sinks |
| **PROPOSED fix** | Redact logging in dedicated PR |
| **Owner** | Voice lane |

---

### SEC-P1-4: Production manual migration apply state incomplete

| Field | Detail |
| --- | --- |
| **What** | Cannot prove all Git scripts applied to production in correct order |
| **Evidence** | **FACT** — TD-P0-2; CLI ledger partial (24 rows) |
| **Impact** | Silent schema drift; `src/db.js` fallbacks mask missing columns |
| **Mitigation** | Phase 3E staging rebuild; Phase 3F drift policy |
| **PROPOSED fix** | Quarterly read-only production catalog audit; ledger backfill |

---

## P2 findings

### SEC-P2-1: Broad initial grants on `tenants`

| Field | Detail |
| --- | --- |
| **What** | `grant select, update on tenants to authenticated` then column-scoped revoke |
| **Evidence** | **FACT** — `foundation_bootstrap.sql` §6; wallet chain refines |
| **Impact** | Low if revoke/grant order correct; risk if script partially applied |
| **Mitigation** | Apply order enforcement; wallet_security_beta final grants |

---

### SEC-P2-2: Legacy Super Admin cookie auth

| Field | Detail |
| --- | --- |
| **What** | `DASHBOARD_PASSWORD` HMAC bypasses Supabase RBAC |
| **Evidence** | **FACT** — TD-P2-1 |
| **Impact** | Weak ops access model; shared password risk |
| **PROPOSED fix** | Supabase role-based admin (future) |

---

### SEC-P2-3: `src/db.js` progressive column fallback

| Field | Detail |
| --- | --- |
| **What** | App retries SELECT with fewer columns if schema lags |
| **Evidence** | **FACT** — DATABASE_GOVERNANCE.md |
| **Impact** | Features degrade silently; drift undetected |
| **Mitigation** | smoke:db + drift policy |

---

### SEC-P2-4: Destructive Super Admin RPCs

| Field | Detail |
| --- | --- |
| **What** | `remove_business_and_release_did` deletes tenant data |
| **Evidence** | **FACT** — `super_admin_ops.sql` |
| **Impact** | Intended admin capability; dangerous if service_role leaked |
| **Mitigation** | service_role server-only; wallet RPC revokes from authenticated |

---

### SEC-P2-5: Signup trigger runs as SECURITY DEFINER chain

| Field | Detail |
| --- | --- |
| **What** | `handle_new_user_tenant()` provisions tenant on auth signup |
| **Evidence** | **FACT** — `did_number_pool.sql` final version |
| **Impact** | Bug could create malformed tenants (fixed #158 overload issue) |
| **Mitigation** | Staging signup smoke in release gate |

---

## P3 findings

### SEC-P3-1: Local dev auth bypasses

| Field | Detail |
| --- | --- |
| **What** | `DASHBOARD_OPEN=true`, unset `VOICE_INTERNAL_SECRET` in dev |
| **Evidence** | **FACT** — ENVIRONMENTS.md |
| **Impact** | None in production if env correct |
| **Rule** | Disable in staging/production |

---

### SEC-P3-2: `anon` role default Supabase grants

| Field | Detail |
| --- | --- |
| **What** | Supabase defaults; Scalers relies on RLS not broad anon table access |
| **Evidence** | **INFERENCE** — member policies restrict authenticated |
| **Impact** | Low if RLS enabled on all tenant tables |
| **PROPOSED** | Periodic `has_table_privilege('anon', ...)` audit |

---

### SEC-P3-3: Hardcoded production Railway URL default

| Field | Detail |
| --- | --- |
| **What** | Desk may default to production voice URL |
| **Evidence** | **FACT** — TD-P3-3 |
| **Impact** | Wrong-environment preview |
| **Mitigation** | ENVIRONMENT_CONTRACT pre-flight checks |

---

## RLS assessment

| Table group | RLS | Policy model | Verdict |
| --- | --- | --- | --- |
| `tenants`, `calls`, `transcripts` | Enabled | `current_user_tenant_ids()` | **PASS** (Git) |
| `tenant_members` | Enabled | Own-row select | **PASS** |
| `contacts`, `service_requests`, `appointments` | Enabled | Tenant member scope | **PASS** |
| `wallet_ledger` | Enabled | Select member; no owner write | **PASS** |
| `ops_audit_log` | Enabled | No authenticated policies | **PASS** |
| `platform_soniox_voices` | RLS + revoke anon/auth | service_role only | **PASS** |

---

## Service role boundary assessment

| RPC / operation | authenticated | service_role | Verdict |
| --- | --- | --- | --- |
| `charge_call_to_wallet` | Revoked | Granted | **PASS** |
| `adjust_tenant_wallet` | Revoked | Granted | **PASS** |
| `assign_did_from_pool` | Revoked | Granted | **PASS** |
| `set_tenant_on_demand_usage` | Granted (owner) | Granted | **PASS** (owner-scoped inside) |
| `set_tenant_soft_spend_limit` | Granted (owner) | Granted | **PASS** |
| Recording upload | N/A | service_role client | **PASS** |

---

## Wallet protection assessment

| Control | Present | Source |
| --- | --- | --- |
| Column-level grant revoke on wallet fields | Yes | `wallet_security_beta.sql` |
| `tenants_protect_wallet_columns` trigger | Yes | Final: `wallet_on_demand_alerts.sql` |
| Ledger immutability triggers | Yes | `one_wallet_billing.sql` |
| Beta billing default off | Yes | `wallet_security_beta.sql` |

**Verdict:** Wallet model is **defense-in-depth** in Git. Production parity assumed via CLI ledger + inference.

---

## Tenant isolation assessment

| Path | Isolation mechanism | Risk |
| --- | --- | --- |
| Owner desk | JWT + RLS + `tenant_members` | Low |
| Voice engine | service_role + explicit `tenant_id` in code | Medium (code must pass correct tenant) |
| Super Admin | service_role + server routes | Medium (route auth required) |
| Signup | Auth trigger creates single tenant | Low (post-#158) |

---

## Storage access assessment

| Path | Method | Policies in Git |
| --- | --- | --- |
| Voice upload | service_role `uploadRecordingBuffer` | No |
| Owner playback | Signed URL / desk proxy | **UNKNOWN** |
| Public anon access | Bucket `public = false` | **FACT** on staging |

---

## Secrets and environment separation

| Control | Status |
| --- | --- |
| Service role not in `NEXT_PUBLIC_*` | **PASS** (by convention) |
| Environment contract document | **NEW** Phase 3F |
| Production ref blocklist for agents | Documented |
| Staging for validation | **PASS** Phase 3E |

---

## Recommendations (priority order)

1. **P1:** Production grant fix for `notify_channels` (approved SQL apply).
2. **P1:** Read-only storage policy introspection on production; commit policies to Git.
3. **P1:** Redact verbose logging (Voice lane PR).
4. **P2:** Production catalog audit to backfill ledger.
5. **P2:** Migrate Super Admin to Supabase RBAC.
6. **PROPOSED:** Staging-only schema drift CI (Phase 3G).

---

## Related documents

- [`../database/SCHEMA_DRIFT_POLICY.md`](../database/SCHEMA_DRIFT_POLICY.md)
- [`../operations/ENVIRONMENT_CONTRACT.md`](../operations/ENVIRONMENT_CONTRACT.md)
- [`../governance/TECHNICAL_DEBT.md`](../governance/TECHNICAL_DEBT.md)
- [`fix_p0_rls_remove_legacy_allow_all.sql`](../supabase/fix_p0_rls_remove_legacy_allow_all.sql)
