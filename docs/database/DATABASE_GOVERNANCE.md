# Database governance

**Status:** Current-state documentation (2026-08-14)  
**Model:** Manual SQL scripts — **not** Supabase CLI migrations.

Do not change the SQL model in this governance phase.

---

## Overview

Scalers uses **Supabase PostgreSQL** as the system of record. Schema evolution is managed through **31 hand-authored SQL files** in `docs/supabase/` with a documented apply order in `docs/supabase/README.md`.

There is **no** `supabase/migrations/` folder in this repository.

---

## What is version controlled

| Artifact | Location | Role |
| --- | --- | --- |
| SQL apply scripts (31 files) | `docs/supabase/*.sql` | Authoritative **intent** for schema changes |
| Apply order index | `docs/supabase/README.md` | Dependency tiers and numbering |
| Schema reference | `docs/supabase/schema.sql` | Introspected 2026-08-06 — **reference only, do not apply** |
| Voice DB API | `src/db.js` | Application contract over live schema |
| Product/billing docs | `docs/ONE_WALLET_BILLING.md`, etc. | Business rules for RPC behavior |

---

## What is NOT version controlled

| Item | Status |
| --- | --- |
| Live Supabase project state | External |
| Record of which scripts applied on production | **UNKNOWN** |
| Migration version table | Not in repo |
| Supabase CLI config | Not in repo |

---

## Apply order (summary)

Full detail: [`../supabase/README.md`](../supabase/README.md).

| Tier | Topics | Example files |
| --- | --- | --- |
| 1 | Membership + RLS | `multi_tenant_onboarding.sql`, `owner_rls.sql` |
| 2 | Tenant profile | `tenant_business_profile.sql`, `voice_languages.sql` |
| 3 | Knowledge acquisition | `knowledge_acquisition_phase1.sql`, `employee_training.sql`, `hours_schedule.sql`, … |
| 4 | Additive tenant columns | `alert_email.sql`, `tts_lexicon.sql`, `soniox_voice_id.sql` |
| 5 | Owner CRM | `lead_status.sql`, `call_resolution.sql` |
| 6 | DID + Super Admin | `did_number_pool.sql`, `super_admin_ops.sql` |
| 7 | Wallet (strict sequence) | `wallet_metering.sql` → `one_wallet_billing.sql` → `wallet_security_beta.sql` → … |
| 8 | Agent tools | `agent_tools.sql` |
| 9 | Business intelligence | `business_operating_model.sql`, `contacts_and_requests.sql`, `product_catalog_and_social.sql` |

**Legacy — do not apply:** `escalation_enabled.sql` (Telegram-era stub; app does not read it).

---

## Manual application process

1. Identify correct script and **predecessor** from README.
2. Run in Supabase SQL Editor or `psql` against target project.
3. Prefer additive, idempotent scripts (`if not exists`, safe backfills).
4. Update README if adding new scripts (append with "after X" note).
5. **Record externally** which script was applied (runbook — future: version table).

**Platform lane owns** new SQL shapes. Ops specifies wallet/DID behavior; Platform implements.

---

## `schema.sql` role

- Introspected live shape notes for `tenants`, `calls`, `transcripts`, and related tables.
- Header: **REFERENCE ONLY — not an apply migration**.
- Use for onboarding and `src/db.js` mapping — not for provisioning new environments alone.

---

## `src/db.js` fallback behavior

**FACT:** `getTenantById` / `getTenantProfile` use progressive SELECT lists — if newer columns are missing on a lagging database, queries fall back to older column sets.

**Evidence:** Multiple `select(...)` attempts with decreasing column lists in `src/db.js` (~lines 661–765).

**Implication:** Application may run against partially migrated databases, but features silently degrade rather than failing loudly.

**Risk:** Masks schema drift — production may be on an unknown tier.

---

## Access patterns

| Consumer | Auth | Client |
| --- | --- | --- |
| Voice engine | Service role | `src/lib/supabaseClient.js` |
| Owner desk | Supabase Auth JWT + RLS | `@supabase/ssr` anon |
| Super Admin / signup | Service role (server-only) | Dashboard admin client |

**Invariant:** Service role never in `NEXT_PUBLIC_*`.

Stable voice API surface documented in `docs/agents/PLATFORM.md` and [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md).

---

## Reproducibility assessment

| Question | Answer |
| --- | --- |
| Can a new environment be built from Git? | **Partially** — apply all scripts in order on empty Supabase project with base tables |
| Is production state reproducible from Git alone? | **No** — without knowing applied tier |
| Are migrations authoritative? | **Scripts in Git are authoritative for intent**; live DB is authoritative for reality |

---

## Risks

1. **Unknown production tier** — highest operational risk (P0 debt TD-P0-2).
2. **Wallet script order** — strict sequence; wrong order can break RPCs.
3. **No automated drift detection** — column fallbacks hide problems.
4. **Manual apply human error** — skipped or duplicate scripts.

---

## Future project: Supabase CLI migrations

**Label:** FUTURE ARCHITECTURE PROJECT — requires **live DB audit first**.

Do not adopt CLI migrations until:

1. Production applied script list is documented.
2. Baseline migration generated from verified live schema or full script replay on clean project.
3. Platform lane owns cutover without breaking `src/db.js` contract.

---

## Related documents

- [`../supabase/README.md`](../supabase/README.md)
- [`../supabase/schema.sql`](../supabase/schema.sql)
- [`../governance/HISTORY_GAPS.md`](../governance/HISTORY_GAPS.md)
- [`../governance/TECHNICAL_DEBT.md`](../governance/TECHNICAL_DEBT.md)
