# Phase 3F baseline audit

**Date:** 2026-08-15  
**Branch audited:** `origin/main` @ `0a56e44`  
**Phase 3E status:** CLOSED (merged PRs #155–#159)  
**Production ALCR:** NOT inspected or modified in this phase

---

## Repository state

| Item | Value | Evidence type |
| --- | --- | --- |
| Current commit | `0a56e44586ea62118d1a6634ffc9a162836c736f` | FACT |
| Branch | `main` (clean at audit start) | FACT |
| Phase 3F branch | `cursor/phase-3f-release-hardening-d058` | FACT |
| SQL artifacts in `docs/supabase/` | 35 files | FACT |
| `supabase/migrations/` in repo | Absent | FACT |
| CI workflows | `.github/workflows/` present (dashboard lint from #153) | FACT |

### Recent merged work (Phase 3D–3E)

| PR | Summary | Merge commit |
| --- | --- | --- |
| #155 | `notify_channels` + `appointments` reconciliation | `84fa5a1` |
| #156 | `foundation_bootstrap.sql` + provenance + `MIGRATION_LEDGER.md` | `c0985f0` |
| #157 | Staging rebuild execution report | `3b76b66` |
| #158 | Signup `default_tenant_llm_prompt` overload fix | `f61c11f` |
| #159 | Staging `smoke-db.js` pass documented | `0a56e44` |

---

## Test state (2026-08-15, Phase 3F audit)

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Voice unit tests | `npm run test:voice` | **PASS** | All sub-suites green |
| Brain / MVP | `npm run test:mvp` | **PASS** | Includes smoke scripts |
| Dashboard lint | `cd dashboard && npm run lint` | **PASS** | 1 pre-existing warning (`PronunciationCoach.tsx`) |
| Dashboard build | `cd dashboard && npm run build` | **PASS** | Next.js production build |
| DB smoke | `npm run smoke:db` | **PASS** | Against configured staging project (local `.env`, not committed) |

**INFERENCE:** Application test baseline is healthy on `main`. DB smoke requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` pointing at a non-production project.

---

## Database documentation state

| Artifact | Location | Status |
| --- | --- | --- |
| Apply order index | `docs/supabase/README.md` | Authoritative for intent |
| Migration ledger | `docs/supabase/MIGRATION_LEDGER.md` | Dual-model index; hardened in Phase 3F |
| Foundation bootstrap | `docs/supabase/foundation_bootstrap.sql` | Production-introspected; do not apply to ALCR |
| Bootstrap provenance | `docs/supabase/foundation_bootstrap.provenance.md` | Methodology + gaps |
| Schema reference | `docs/supabase/schema.sql` | Reference only; superseded for bootstrap |
| Governance | `docs/database/DATABASE_GOVERNANCE.md` | Pre-3F; partially stale on reproducibility |
| Staging evidence | `docs/operations/STAGING_REBUILD_EXECUTION_REPORT.md` | Phase 3E execution log |

### Foundation bootstrap

- **FACT:** Reconstructs `tenants` (49 cols), `calls` (15), `transcripts` (6) from production catalog introspection (Phase 3D-4).
- **FACT:** Historical `CREATE TABLE` provenance is **UNKNOWN**.
- **FACT:** Sections §5–7 (RLS, grants, wallet trigger) require `current_user_tenant_ids()` from `owner_rls.sql`.
- **PROPOSED:** Greenfield apply splits bootstrap: §1–4 → tier 1 → §5–7 (proven on staging in Phase 3E).

### Migration ledger

- Documents foundation tables, 24 production CLI migration rows, manual script tiers, column lineage, storage bucket gap.
- **UNKNOWN:** Per-script production apply dates for most manual scripts.
- **FACT:** `fix_p0_rls_remove_legacy_allow_all.sql` applied production 2026-08-14; not in CLI ledger.

---

## Feature SQL inventory

35 SQL files in `docs/supabase/`. Grouped by domain:

| Domain | Files | Apply tier (README) |
| --- | --- | --- |
| Foundation | `foundation_bootstrap.sql` | 0 (split apply) |
| Membership + RLS | `multi_tenant_onboarding.sql`, `owner_rls.sql` | 1 |
| Tenant profile | `tenant_business_profile.sql`, `voice_languages.sql` | 2 |
| Knowledge | `knowledge_acquisition_phase1.sql`, `employee_training.sql`, `hours_schedule.sql`, `services_catalog.sql`, `after_hours_mode.sql`, `daily_bulletin.sql` | 3 |
| Additive columns | `alert_email.sql`, `notify_channels.sql`, `tts_lexicon.sql`, `pronunciation_gemini_scan.sql`, `soniox_voice_id.sql` | 4 |
| Owner CRM | `lead_status.sql`, `lead_status_archive.sql`, `call_resolution.sql` | 5 |
| DID / Super Admin | `did_number_pool.sql`, `super_admin_ops.sql` | 6 |
| Wallet | `wallet_metering.sql`, `one_wallet_billing.sql`, `wallet_security_beta.sql`, `fix_charge_call_wallet_ambiguous.sql`, `wallet_soft_spend_limit.sql`, `wallet_on_demand_alerts.sql` | 7 |
| Agent tools | `agent_tools.sql` | 8 |
| BI / CRM | `business_operating_model.sql`, `contacts_and_requests.sql`, `product_catalog_and_social.sql`, `appointments.sql` | 9 |
| Security repair | `fix_p0_rls_remove_legacy_allow_all.sql` | Post-tier |
| Legacy (do not apply) | `escalation_enabled.sql` | N/A |
| Reference only | `schema.sql` | N/A |

---

## Application architecture (summary)

| Layer | Technology | Key paths |
| --- | --- | --- |
| Voice engine | Node.js + Express + WebSocket | `server.js`, `src/db.js`, `src/lib/supabaseClient.js` |
| Owner desk | Next.js (App Router) | `dashboard/` |
| Database | Supabase PostgreSQL 17.6 | `docs/supabase/*.sql` |
| Auth | Supabase Auth | Signup trigger `handle_new_user_tenant()` |
| Voice STT/TTS | Soniox | `src/soniox*.js` |
| LLM | Gemini | Brain lane |
| Telecom | SautiKit | Webhooks to voice engine |
| Storage | Supabase Storage (`call-recordings`) | `src/db.js` upload via service_role |

**Access model:**

- Voice + Super Admin + signup: **service_role** (bypasses RLS)
- Owner desk: **authenticated** JWT + RLS via `current_user_tenant_ids()`

Stable DB contract: `src/db.js` (Platform lane owns changes).

---

## Staging environment reference

| Field | Value | Evidence |
| --- | --- | --- |
| Name | `scalers-staging` | FACT (Phase 3E) |
| Project ref | `sgcdncjxauhsbunobmob` | FACT |
| URL | `https://sgcdncjxauhsbunobmob.supabase.co` | FACT |
| Region | `eu-west-2` | FACT |
| Postgres | 17.6 | FACT |
| Rebuilt from Git | YES (manual SQL path, Phase 3E) | FACT |
| Signup provisioning | PASS (after #158) | FACT |
| `smoke-db.js` | PASS | FACT |

**FACT:** Staging was created and validated in Phase 3E. It is the canonical pre-production database target.

---

## Production reference (read-only; do not modify)

| Field | Value |
| --- | --- |
| Name | ALCR |
| Project ref | `fjxcdccgyhnvnnlnovcl` |
| URL | `https://fjxcdccgyhnvnnlnovcl.supabase.co` |
| Postgres | 17.6 |

**FACT:** Production was NOT modified in Phase 3E or this baseline audit.

---

## Known production / staging differences

| Area | Production (ALCR) | Staging | Classification |
| --- | --- | --- | --- |
| `notify_channels` UPDATE grant | Absent | Applied as staging test fix | **FACT** (reproduced gap) |
| Storage policies (`call-recordings`) | **UNKNOWN** | None in `pg_policies` | **UNKNOWN** |
| Secondary indexes on foundation tables | Not in bootstrap | Matches bootstrap | **FACT** (parity) |
| Available DID pool rows | **UNKNOWN** count | 0 available (manual seed needed) | **FACT** (staging gap) |
| CLI migration history table | 24 rows | Not replayed (manual path) | **FACT** |
| Data | Live tenant/call data | Test/smoke data only | **FACT** |

---

## Known technical debt (selected)

From `docs/governance/TECHNICAL_DEBT.md` plus Phase 3E outcomes:

| ID | Summary | Phase 3F note |
| --- | --- | --- |
| TD-P0-1 | No per-call agent config traceability | OPEN |
| TD-P0-2 | Production migration apply state unknown | **PARTIALLY MITIGATED** — staging rebuild proves Git path; production ledger still incomplete |
| TD-P1-3 | No full CI gate | OPEN (lint CI exists; voice/mvp not in CI) |
| TD-P2-5 | No staging environment | **RESOLVED** in Phase 3E — docs lagging |
| TD-P2-4 | Dashboard lint failure | **RESOLVED** (warning only) |

---

## Known security issues (pre-3F review)

| Issue | Severity | Status |
| --- | --- | --- |
| Legacy allow-all RLS policies | P0 | **FIXED** production 2026-08-14 (`fix_p0_rls_remove_legacy_allow_all.sql`) |
| `notify_channels` missing UPDATE grant | P1 | OPEN on production; documented |
| Storage bucket policies not in Git | P1 | **UNKNOWN** production state |
| Broad table-level grants before column revoke pattern | P2 | By design; wallet scripts tighten |
| Legacy Super Admin cookie auth | P2 | OPEN (TD-P2-1) |
| Verbose request logging (PII) | P1 | OPEN (TD-P1-4) |

Full classification: `docs/security/PHASE_3F_SECURITY_REVIEW.md`.

---

## Known operational gaps

1. No automated schema drift detection (addressed in Phase 3F policy doc).
2. No formal release gate checklist enforced in CI (addressed in Phase 3F).
3. Production SQL apply ledger incomplete for manual scripts.
4. No documented rollback SQL for additive migrations (forward-fix only).
5. Desk E2E on staging marked PENDING in Phase 3E report.
6. `ENVIRONMENTS.md` still lists staging as UNKNOWN (updated in Phase 3F).

---

## Phase 3F scope

This phase produces governance and release documentation only. No product features. No production SQL execution.

**Deliverables:** See `docs/operations/PHASE_3F_COMPLETION_REPORT.md`.

---

## Related documents

- [`STAGING_REBUILD_EXECUTION_REPORT.md`](./STAGING_REBUILD_EXECUTION_REPORT.md)
- [`../supabase/MIGRATION_LEDGER.md`](../supabase/MIGRATION_LEDGER.md)
- [`../database/DATABASE_EVOLUTION.md`](../database/DATABASE_EVOLUTION.md)
- [`../database/DATABASE_APPLY_ORDER.md`](../database/DATABASE_APPLY_ORDER.md)
